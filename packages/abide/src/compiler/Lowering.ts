import { SyntaxKind } from 'typescript/unstable/ast'

import type { CheckerAnswer } from './CheckerAnswer.ts'
import type { Read } from './classifyRead.ts'
import { holdsSlot } from './classifyTemplate.ts'
import type { Finding } from './Finding.ts'
import { type AbideFile, scriptBodies } from './parseAbide.ts'
import {
    type Origin,
    type Projection,
    projectShadow,
    type Span,
} from './projectShadow.ts'
import { importedNames } from './splitImports.ts'
import type { InlineComponent, Setup, TemplateNode } from './TemplateNode.ts'
import { nesting, type Token, tokenize } from './tokenize.ts'

// 31.1 and 31.4 — inside a `.abide` a name bound to a `Reactive` is READ where it stands and
// WRITTEN where it is assigned.
//
// WHICH BINDING AN OCCURRENCE REACHES, AND WHAT IT DOES THERE, ARE THE CHECKER'S ANSWERS, not this
// file's. `TypeSession` asks them of the file's projection (`projectShadow`) and hands back READS,
// each classified off TypeScript's own syntax tree (`classifyRead`). A parameter, a loop variable,
// a row's item (31.10), a destructured name, a label, a key, a member and a class field reach
// something else, and are absent. What is left here is the splice: what a read, a write, an update
// and a shorthand lower TO.

// 31.4 — THE THREE THAT SHORT-CIRCUIT. `n ||= v` writes only where the read is falsy, and an
// unconditional `n.set(n() || v)` stores the value it already held — every reader woken for a
// value that never moved, which is the failure no correctness test can see.
//
// THE READ STANDS IN FRONT AND NOTHING WRAPS IT. A parenthesized `(n() || n.set(v))` reads as a
// call on the line above it — ASI refuses to break in front of a `(` — and the operator binds
// looser than everything an author can legally write around an assignment, so the bare form needs
// no parentheses to survive one.
const SHORT_CIRCUIT: ReadonlySet<string> = new Set(['||', '&&', '??'])

/**
 * 32.67 — how a `{#for}` row's item is read where it is being emitted.
 *
 * `own` is the row's own top level, whose slots reading the item and nothing that moves are written
 * by the row's `make` and `update` and bind nothing; a binding there is an item watch, the one
 * writer of its slot, reading the item through `itemOf`.
 * `nested` is inside a region of the row, a branch-local `<script>` or anything else the `update`
 * does not reach, where every read but a listener's is a read of the cell. Where an item has no mode
 * it is read as the value.
 */
type ItemMode = 'own' | 'nested'
/** 32.67 — how many reads of a row's item were emitted as a cell call and as a record read. */
export type ItemUses = { cell: number; record: number }

/** 23.9 — a page's or a layout's route, which its `route.params` promises. */
export type Routed = { route: string; kind: 'page' | 'layout' }

/** A run of emitted code a `Lowering` wrote, and where each of its runs stood in the projection. */
export type LoweredChunk = { text: string; origins: Origin[] }

/**
 * One file's lowering: each piece the emitters ask for, with its reactive reads rewritten.
 *
 * Every piece the emitters ask for — a script, a slot, a subject, a key — is a SPAN of the
 * projection, and a nested value (the right of a write, a computed path segment) is a span of the
 * same text lowered by the same splice. `used` collects the framework names the rewrite EMITTED,
 * so the import goes with the call; left to the callers it is one `used.add` per call site and a
 * missed one emits a module calling a name it never imported.
 */
export class Lowering {
    readonly projection: Projection
    readonly used = new Set<string>()
    readonly answer: CheckerAnswer
    /**
     * 32.18 — whether the template holds a `<slot/>`, walked ONCE here.
     *
     * Both emitters ask `takesProps()` about the same file, and the walk was a recursion over the
     * whole template per lane per file — twice the work for an answer fixed when the file was
     * parsed.
     */
    readonly holdsSlot: boolean
    /**
     * 38.3 — lowering for the checker rather than for a module that runs (`checkedShadow`).
     *
     * Two spellings differ, each because the emitted one is right at run time and untyped: the
     * props record, which the checker needs typed as the accessors it is; and a member referenced
     * rather than called, whose forwarding arrow takes an untyped rest.
     */
    readonly checking: boolean
    /**
     * Whether a script imports abide's own `raw`, which a checked lowering then leaves a template's
     * `raw(x)` calling — the same function, and the import read where the author reads it.
     */
    private readonly importsRaw: boolean
    /**
     * The names a checked lowering read, each with whether it was read through a props accessor.
     *
     * A read is `__values.name` there rather than `name()`: two calls are two values to the
     * checker, so `{thread ? thread.text : ''}` failed to narrow where the program it lowers to
     * reads one value twice — and a property of one declared record narrows (`checkedShadow`).
     */
    readonly values = new Map<string, boolean>()
    /**
     * What a checked lowering found that a build refuses, at the projection offset of the read.
     *
     * Collected rather than thrown, so one refusal is one finding and the rest of the file is
     * still checked.
     */
    readonly refusals: Finding[] = []
    /**
     * 38.97 — where given, each chunk this lowering hands an emitter, with where its runs stood in
     * the projection: what `sourceMapOf` finds in the module the emitter writes.
     */
    private readonly chunks: LoweredChunk[] | undefined
    /**
     * 23.9 — for a checked lowering of a page or a layout, its route and which of the two it is:
     * what its `route.params` is typed by.
     */
    private readonly routed: Routed | undefined
    /**
     * 32.67 — per `{#for}` item (by where its binding starts), how a read of it is emitted now, the
     * name its row's record is held under, and how it was read. Set by the client's emitter around
     * a row's mount alone (`readItemsAs`).
     */
    private readonly itemModes = new Map<
        number,
        { mode: ItemMode; record: string; uses: ItemUses }
    >()
    /**
     * What is being lowered that reads a row's item off its record: a listener, at any depth, or a
     * binding of the row's own top level (`binding`); `null` for anything else.
     */
    private recording: 'listener' | 'binding' | null = null

    constructor(
        file: AbideFile,
        answer: CheckerAnswer,
        checking = false,
        chunks?: LoweredChunk[],
        routed?: Routed,
    ) {
        this.projection = projectShadow(file)
        this.answer = answer
        this.holdsSlot = holdsSlot(file.template)
        this.checking = checking
        this.importsRaw = importsAbideRaw(file)
        this.chunks = chunks
        this.routed = routed
    }

    /**
     * 32.67 — where a `{#for}` block's item binding starts, the key every item question is asked by.
     */
    private itemOf(block: object): number {
        return this.projection.items.get(block) ?? -1
    }

    /**
     * 32.67 — emits `body` with `block`'s item read in `mode`, its record held as `record` for a
     * listener, and answers how the item was read: as a cell, or off the record.
     */
    readItemsAs(
        block: object,
        mode: ItemMode,
        record: string,
        body: () => void,
    ): ItemUses {
        const item = this.itemOf(block)
        const uses = { cell: 0, record: 0 }
        this.itemModes.set(item, { mode, record, uses })
        try {
            body()
        } finally {
            this.itemModes.delete(item)
        }
        return uses
    }

    /**
     * 32.67 — emits `body` with every row item read at its own top level read as `nested`: what a
     * region of the row binds is bound to the cell, since the row's `update` reaches only its own
     * top level.
     */
    nestItems(body: () => void): void {
        const own: { mode: ItemMode }[] = []
        for (const reading of this.itemModes.values())
            if (reading.mode === 'own') own.push(reading)
        for (const reading of own) reading.mode = 'nested'
        try {
            body()
        } finally {
            for (const reading of own) reading.mode = 'own'
        }
    }

    /**
     * 32.67 — a listener, lowered: it runs on an event rather than in a binding, so a row's item is
     * read off the row's record, which allocates nothing a row.
     */
    listener(holder: object): string {
        return this.recorded('listener', holder)
    }

    /**
     * 32.67 — a text or attribute binding's value, lowered: at a row's own top level it reads the
     * item through `itemOf`, off the record until the row's first new item makes it a cell, so a row
     * that never takes one allocates nothing for it.
     */
    binding(holder: object): string {
        return this.recorded('binding', holder)
    }

    /**
     * 32.67 — whether a binding reads a row's item at that row's own top level, which makes it one
     * of the row's item watches (`Scope.itemWatch`).
     */
    readsOwnItem(holder: object): boolean {
        return this.holdsRead(
            holder,
            (read) =>
                read.item !== -1 &&
                this.itemModes.get(read.item)?.mode === 'own',
        )
    }

    private recorded(as: 'listener' | 'binding', holder: object): string {
        const was = this.recording
        this.recording = as
        try {
            return this.expression(holder)
        } finally {
            this.recording = was
        }
    }

    /** 32.67 — whether a position reads any row's item. */
    readsAnItem(holder: object): boolean {
        return this.holdsRead(holder, (read) => read.item !== -1)
    }

    /** 32.67 — whether a position reads `block`'s item. */
    readsItem(holder: object, block: object): boolean {
        const item = this.itemOf(block)
        return this.holdsRead(holder, (read) => read.item === item)
    }

    /**
     * 32.67 — the names a row reads its item through, in the `{#for}`'s scope: its pattern's names,
     * or the one name.
     */
    itemNames(block: object): Set<string> {
        const item = this.itemOf(block)
        const names = new Set<string>()
        for (const read of this.answer.reads)
            if (read.item === item)
                names.add(this.projection.text.slice(read.start, read.end))
        return names
    }

    /**
     * Whether this file is a component that takes a props record.
     *
     * 33 — the one thing the emitters need from the props pass: the emitted function takes the
     * record, and a file that never calls `props` takes none (33.2).
     *
     * A `<slot/>` IS THAT QUESTION WITH A SECOND ANSWER (32.18): the caller's children arrive on
     * the props record, so a file holding one takes props whether or not it names them. Answered
     * here rather than at each emitter, or a third reason to take the record has to be remembered
     * in two files.
     */
    takesProps(): boolean {
        return this.holdsSlot || this.ownPropsRead() !== undefined
    }

    /**
     * The file's own `props` call, or `undefined` where it makes none.
     *
     * In its `<script>`: an inline component's takes its own (32.40). What a caller is held to
     * is read off the same call (`checkedShadow`'s `propsOf`), so the record the emitted function
     * takes and the type the checker holds a caller to are one finding.
     */
    ownPropsRead(): Read | undefined {
        const scriptsEnd = this.projection.scripts.end
        for (const read of this.answer.reads)
            if (read.shape === 'props' && read.start < scriptsEnd) return read
        return undefined
    }

    /**
     * Whether this file calls `reactive.share`, and so opens a share scope of its own.
     *
     * 10.5 — the one thing the emitters need from 10: a component that calls `reactive.share` gets
     * a scope of its own, and one that does not is a link a descendant's walk passes through. So
     * two `<Shelf/>` each hold their own `queued` and a `<TrackRow/>` finds the page's `nowPlaying`
     * — with no node, and nothing to pay, on every file that shares nothing.
     *
     * 10.2 IS CHECKED IN THE SAME SCAN: the key is a literal or it is a build error. Found by
     * SPELLING, as `raw` is — a file that binds its own `reactive` is not something the token walk
     * can see, and that is the same limit 32.25 already carries.
     */
    opensShareScope(): boolean {
        const text = this.projection.text
        if (!text.includes('.share')) return false
        const tokens = tokenize(text)
        let found = false
        for (let at = 0; at < tokens.length - 3; at += 1) {
            if ((tokens[at] as Token).text !== 'reactive') continue
            if ((tokens[at + 1] as Token).kind !== SyntaxKind.DotToken) continue
            if ((tokens[at + 2] as Token).text !== 'share') continue
            const open = tokens[at + 3] as Token
            if (open.kind !== SyntaxKind.OpenParenToken) continue
            const key = tokens[at + 4] as Token | undefined
            if (key?.kind !== SyntaxKind.StringLiteral)
                throw new Error(
                    'abide: a reactive.share key is a literal — the scope it gets or creates in is decided where it is written. RULEBOOK 10.2.',
                )
            found = true
        }
        return found
    }

    /**
     * A framework name as emitted code calls it (`__name`), registered for the import.
     *
     * Registered in the same breath — which is the whole reason it is one call. See `importClause`
     * for the alias.
     */
    use(name: string): string {
        this.used.add(name)
        return `__${name}`
    }

    /** The `<script module>` blocks, joined as the file wrote them and lowered. */
    modules(): string {
        return this.lowerChunk(this.projection.modules)
    }

    /** The `<script server>` blocks, joined as the file wrote them and lowered. */
    servers(): string {
        return this.lowerChunk(this.projection.servers)
    }

    /** The `<script>` blocks, joined as the file wrote them and lowered. */
    scripts(): string {
        return this.lowerChunk(this.projection.scripts)
    }

    /** A template expression, lowered. */
    expression(holder: object): string {
        return grouped(this.lowerChunk(this.spanOf(holder)))
    }

    /**
     * 14.8 — a branch-local `<script>`: statements, spliced as a body rather than as one value.
     *
     * 32.40 — AND AN INLINE COMPONENT'S HEAD, the `props` statement its pattern is bound by, which
     * lowers to its own record as a file's does to the file's.
     */
    setup(holder: Setup | InlineComponent): string {
        return this.lowerChunk(this.spanOf(holder))
    }

    /**
     * A `bind:` operand, lowered with the operand's own read left as the `Reactive`.
     *
     * 31.3 — A `bind:` OPERAND HOLDS THE `Reactive`, which is the one template position where a
     * bare name is not a read: `bind:element={field}` puts the node IN the value, so lowering it
     * to `field()` hands the binding whatever the value happens to be instead.
     *
     * ONLY THE OPERAND ITSELF. A name nested anywhere inside — the write in
     * `bind:element={(node) => { tag = node.tagName }}` — is an ordinary position and is lowered
     * as one, which is why this is the same walk with one read left alone rather than the source
     * passed through.
     */
    reference(holder: object): string {
        const span = this.spanOf(holder)
        return this.boundPath(span) ?? grouped(this.lowerChunk(span, true))
    }

    /**
     * 32.5, 31.8 — A `bind:` OPERAND THAT IS A PATH INTO A VALUE, `contact.address.city`, as the
     * `{ get, set }` pair a binding writes through: the read for its get, and the write 31.8 lowers
     * `contact.address.city = v` to for its set. Lowered as a read, the binding was handed the city
     * as a string and had nothing to write the typed text back into.
     *
     * A COMPUTED STEP IS EMITTED SOURCE, as 31.8's is: `params[s.k]` writes through `s.k` lowered,
     * so the key is read when the input writes and the get reads it too — the binding follows the
     * key. A `!` is a type and no step. `undefined` for an operand that is not a name followed by
     * steps, which `reference` lowers as it stands — save 32.76's optional step, which is refused.
     */
    private boundPath(span: Span): string | undefined {
        const source = this.projection.text
        const text = source.slice(span.start, span.end)
        const from = span.start + (text.length - text.trimStart().length)
        const to = span.start + text.trimEnd().length
        const read = this.answer.reads[this.answer.firstRead(from)]
        if (
            read === undefined ||
            read.from !== from ||
            read.shape !== 'value' ||
            read.item !== -1
        )
            return undefined
        const tokens = tokenize(source.slice(read.to, to))
        const segments: string[] = []
        for (let at = 0; at < tokens.length; at += 1) {
            const token = tokens[at] as Token
            if (token.kind === SyntaxKind.ExclamationToken) continue
            if (token.kind === SyntaxKind.QuestionDotToken)
                throw new Error(
                    `abide: bind:{${source.slice(from, to)}} writes through an optional step, and nothing can be written through one. Bind the path without ?., or a { get, set } pair. RULEBOOK 32.76.`,
                )
            if (token.kind === SyntaxKind.DotToken) {
                at += 1
                const step = tokens[at]
                if (step === undefined || !/^[A-Za-z_$][\w$]*$/.test(step.text))
                    return undefined
                segments.push(JSON.stringify(step.text))
                continue
            }
            if (token.kind !== SyntaxKind.OpenBracketToken) return undefined
            let depth = 1
            let close = at + 1
            for (; close < tokens.length; close += 1) {
                depth += nesting((tokens[close] as Token).kind)
                if (depth === 0) break
            }
            if (depth > 0 || close === at + 1) return undefined
            segments.push(
                this.lower({
                    start: read.to + token.end,
                    end: read.to + (tokens[close] as Token).start,
                }).trim(),
            )
            at = close
        }
        if (segments.length === 0) return undefined
        const name = this.nameOf(read)
        return `{ get: () => ${this.lowerChunk({ start: from, end: to })}, set: (${STORED}) => ${name}.set(${this.use('writePath')}(${name}(), [${segments.join(', ')}], ${STORED})) }`
    }

    /**
     * The component a tag chooses by a value, lowered to the read of it, or `undefined`.
     *
     * 32.34 — `undefined` where the tag names a component itself. The checker's answer and nothing
     * else: a tag holding no read is a binding that never moves, and a file lowered with no
     * checker invokes it as written.
     */
    chosenTag(node: object): string | undefined {
        const span = this.projection.tags.get(node)
        if (span === undefined || !this.answer.holdsRead(span)) return undefined
        return this.lowerChunk(span)
    }

    /** A `{#for}` block's key expression, lowered. */
    key(block: object): string {
        const span = this.projection.keys.get(block)
        if (span === undefined)
            throw new Error('abide: a {#for} key was never projected.')
        return grouped(this.lowerChunk(span))
    }

    /**
     * Whether a template position is bound: true unless the checker proved it static.
     *
     * 14.2 — bound unless the checker PROVED it reads nothing reactive (`proveSlots`) — not whether
     * it NAMES a `Reactive`, which writes `{big()}` once where `big` reads `n` in its body.
     */
    isLive(holder: object): boolean {
        const span = this.spanOf(holder)
        if (!this.answer.isStatic(span)) return true
        // 32.67 — and inside a region of a row, a position reading the row's item is bound to its
        // cell, which the proof sets aside: the server renders the row once.
        return (
            this.itemModes.size !== 0 &&
            this.answer.holdsRead(span, (read) => this.isNested(read))
        )
    }

    private isNested(read: Read): boolean {
        return (
            read.item !== -1 && this.itemModes.get(read.item)?.mode === 'nested'
        )
    }

    /**
     * Whether any expression in a text run is live (`isLive`).
     *
     * A run of static parts and expressions the checker proved static is written once by the
     * server and never again; opening a binding for it is one waking reader per run for nothing.
     */
    isLiveRun(run: readonly TemplateNode[]): boolean {
        for (const piece of run)
            if (piece.kind === 'expression' && this.isLive(piece)) return true
        return false
    }

    /**
     * Whether any subject of an `{#if}` chain is live (`isLive`); `{:else}` has none.
     *
     * 14.2 — a chain whose every subject is proven static takes one arm for good, so nothing can
     * leave it unlanded on the server (41.4) or wake it on the client.
     */
    isLiveChain(branches: readonly { subject: string }[]): boolean {
        for (const branch of branches)
            if (branch.subject !== '' && this.isLive(branch)) return true
        return false
    }

    /**
     * Whether a text run can hold markup: a part that is live, or a part that calls `raw`.
     *
     * 32.26 — a part the checker PROVED is a primitive (`isLive` false) cannot be `Raw` — the proof
     * is that its value's type is primitive — save 32.25's `raw(x)`, which `provePosition` exempts
     * and which is `Raw` always. So a run of proven parts is text for good, and neither side pays
     * for markup it cannot hold: a row reading its own item, most slots on most pages, is one.
     */
    holdsMarkup(run: readonly TemplateNode[]): boolean {
        for (const piece of run) {
            if (piece.kind !== 'expression') continue
            // The PROOF, not `isLive`: a row's item makes a position live on the client alone, and
            // both lanes have to agree on whether a run is anchored (32.30).
            if (
                !this.answer.isStatic(this.spanOf(piece)) ||
                this.holdsRead(piece, isRawCallee)
            )
                return true
        }
        return false
    }

    /** Whether a read starts inside a template position — one `matches`, where given. */
    holdsRead(holder: object, matches?: (read: Read) => boolean): boolean {
        return this.answer.holdsRead(this.spanOf(holder), matches)
    }

    private spanOf(holder: object): Span {
        const span = this.projection.slots.get(holder)
        if (span === undefined)
            throw new Error('abide: a template expression was never projected.')
        return span
    }

    /** `lower`, the chunk recorded where `chunks` was given. */
    private lowerChunk(span: Span, holds = false): string {
        if (this.chunks === undefined) return this.lower(span, holds)
        const origins: Origin[] = []
        const text = this.lower(span, holds, origins)
        this.chunks.push({ text, origins })
        return text
    }

    /**
     * The source of `span`, every read in it rewritten.
     *
     * A write's value and a computed segment are spans inside it, lowered by the same call, and
     * the reads they hold are skipped by the outer walk because it resumes past them.
     *
     * 38.3 — `origins`, where given, records each run against where the projection held it, so a
     * checker's position in the output is a position in the file: a copied run at its own offset,
     * and a rewritten one as a run of no length at the read it replaced, so anything inside the
     * rewrite is placed at the read. `base` is where the output lands in the text it is added to.
     */
    lower(span: Span, holds = false, origins?: Origin[], base = 0): string {
        const from = span.start
        const to = span.end
        const source = this.projection.text
        // 31.3's position, as a span: the operand with its whitespace off, so a read covering
        // exactly that is the name standing alone.
        const text = source.slice(from, to)
        const wholeFrom = from + (text.length - text.trimStart().length)
        const wholeTo = from + text.trimEnd().length
        const reads = this.answer.reads
        let read = this.answer.firstRead(from)
        if (read === reads.length || (reads[read] as Read).start >= to) {
            origins?.push({ at: base, source: from, length: to - from })
            return source.slice(from, to)
        }

        let out = ''
        let at = from
        const copy = (until: number): void => {
            origins?.push({
                at: base + out.length,
                source: at,
                length: until - at,
            })
            out += source.slice(at, until)
        }
        // What is written next stands in for the source at `origin`, and has no length there.
        const pin = (origin: number): void => {
            origins?.push({ at: base + out.length, source: origin, length: 0 })
        }
        for (; read < reads.length; read += 1) {
            const current = reads[read] as Read
            if (current.start >= to) break
            if (current.start < at) continue
            // 32.67 — a row's item is the value wherever its row is not being mounted.
            if (current.item !== -1) {
                const rewritten = this.itemRead(current)
                if (rewritten === undefined) continue
                copy(current.from)
                pin(current.from)
                out += rewritten
                at = current.to
                continue
            }
            // 31.3 — the operand's own read is the one that does not lower — save that a written
            // prop's name is its accessor, and the operand is the cell the accessor hands back.
            if (holds && current.from === wholeFrom && current.to === wholeTo) {
                if (current.through) {
                    copy(current.from)
                    pin(current.from)
                    out += `${this.projection.text.slice(current.start, current.end)}()`
                    at = current.to
                }
                continue
            }
            // 31.4 — A WHOLE-NAME WRITE BRACKETS ITS RIGHT-HAND SIDE, which is lowered by this same
            // walk and so MAPPED RUN BY RUN where a map is asked for: it is the author's own
            // expression, and pinned to the write's start every error in it read as the same column.
            if (current.shape === 'write' && current.path.length === 0) {
                const [open, close] =
                    this.checkedWriteParts(current) ??
                    writeParts(
                        this.nameOf(current),
                        current.operator,
                        current.discarded,
                    )
                copy(current.from)
                pin(current.from)
                out += open
                out += this.lower(
                    current.value as Span,
                    false,
                    origins,
                    base + out.length,
                ).trim()
                pin(current.to)
                out += close
                at = current.to
                continue
            }
            // 38.116 — THE CHECKER'S `props` CALL IS COPIED INSIDE ITS WRAPPER, so its type is the
            // author's text where a rename looks for it, and a finding in it lands where written.
            if (this.checking && current.shape === 'props') {
                copy(current.from)
                pin(current.from)
                out += '__accessors('
                origins?.push({
                    at: base + out.length,
                    source: current.from,
                    length: current.to - current.from,
                })
                out += source.slice(current.from, current.to)
                pin(current.to)
                out += this.checkedPropsClose(current)
                at = current.to
                continue
            }
            const rewritten = this.rewrite(current)
            if (rewritten === undefined) continue
            copy(current.from)
            pin(current.from)
            out += rewritten
            at = current.to
        }
        copy(to)
        return out
    }

    /**
     * 33.4 — what closes the `__accessors(` the checker's `props` call is wrapped in: the record
     * of accessors the caller passed, with the keys the child writes (33.6) and the keys it
     * defaults (33.20).
     */
    private checkedPropsClose(read: Read): string {
        const written =
            read.path.length === 0
                ? ''
                : `, ${JSON.stringify(read.path.map((key) => key.name))}`
        const without =
            read.keys.length === 0
                ? ''
                : `${written === '' ? ', []' : ''}, ${JSON.stringify(read.keys)}`
        return `${written}${without})`
    }

    /**
     * The read's name as emitted: `name()` for a written prop, whose cell its accessor hands back.
     *
     * 33.6 — a written prop's cell is reached through its accessor.
     */
    private nameOf(read: Read): string {
        const spelled = this.projection.text.slice(read.start, read.end)
        // 23.9 — WHAT THIS PAGE'S OWN ROUTE PROMISES, for the checker alone: the running module
        // reads the one `route` every page shares.
        if (this.routed !== undefined && read.routeParams)
            return `(${spelled} as unknown as () => __RouteParams<${JSON.stringify(this.routed.route)}, ${JSON.stringify(this.routed.kind)}>)`
        return read.through ? `${spelled}()` : spelled
    }

    /**
     * 32.67 — one read of a row's item: the value as written outside its row's mount, the record's
     * value in a listener, `itemOf` the record in a binding of the row's own top level, and the
     * cell's read everywhere else in it.
     */
    private itemRead(read: Read): string | undefined {
        const reading = this.itemModes.get(read.item)
        if (reading === undefined) return undefined
        const { mode, record, uses } = reading
        const spelled = this.projection.text.slice(read.start, read.end)
        let value = `${spelled}()`
        if (
            this.recording === 'listener' ||
            (this.recording === 'binding' && mode === 'own')
        ) {
            const from =
                this.recording === 'listener'
                    ? `${record}.data`
                    : `${this.use('itemOf')}(${record})`
            // A PATTERN'S NAME is no member of the value at one path, so it is the list's own picker
            // of that name (`rowPickers`), handed the record's value.
            const text = this.projection.text
            const named =
                text.slice(read.item, read.item + spelled.length) === spelled &&
                !/[\w$]/.test(text[read.item + spelled.length] ?? '')
            value = named ? from : `${record}_${spelled}(${from})`
            uses.record += 1
        } else uses.cell += 1
        return read.shape === 'shorthand' ? `${spelled}: ${value}` : value
    }

    /** What one read lowers to, or `undefined` where it stays exactly as written. */
    private rewrite(read: Read): string | undefined {
        const spelled = this.projection.text.slice(read.start, read.end)
        const name = this.nameOf(read)
        switch (read.shape) {
            case 'asWritten':
                return read.through ? name : undefined
            // 31.5 — the member BOUND to the `Reactive`, arguments and all.
            case 'member':
                return this.checking
                    ? `${name}.${read.path[0]?.name}`
                    : `((...args) => ${name}.${read.path[0]?.name}(...args))`
            // 31.7 — the explicit spelling keeps compiling. 31.11 — AND IT TAKES NO ARGUMENTS.
            // Passed through, `count(5)` calls the read with a value the read ignores: an author
            // who meant a write, silently given one.
            case 'call':
                if (read.arguments > 0) {
                    const message = `abide: ${spelled}() is a read by name and takes no arguments, and this one is given one. Write ${spelled}.set(…) to write it. RULEBOOK 31.11.`
                    if (!this.checking) throw new Error(message)
                    this.refusals.push({ at: read.start, message })
                }
                return name === spelled ? undefined : name
            // 33.15 — a props rest element's member: the key's accessor, called.
            case 'restMember':
                return `${spelled}?.()`
            // 33.22 — the rest element handed on whole: the values its accessors read.
            case 'restWhole':
                return `${read.keys.length === 0 ? '' : `${spelled}: `}${this.use('restValues')}(${spelled})`
            // 31.1 — a read. A member that is not the `Reactive`'s own reaches the value (31.5,
            // 31.6), so `regions.join(', ')` reads first and `n?.x` reads `n()?.x`.
            case 'value':
                return this.valueOf(spelled, read, name)
            // AN OBJECT SHORTHAND IS A KEY AND A VALUE. `{ n }` means `{ n: n }`, so the key has
            // to stay `n` and only the value lowers — `{ n() }` is a method with no body.
            case 'shorthand':
                return `${spelled}: ${this.valueOf(spelled, read, name)}`
            // 33.4 — the call IS the record of accessors the caller passed, so the pattern an
            // author wrote destructures that rather than a value nothing has. 33.6, 33.7 — a key
            // the child writes (`path`) is its cell instead (`propCells`).
            // 33.20 — a defaulted key leaves the record, so its default always stands and asks the
            // caller's accessor itself (`propOr`); its cell, where the child writes it, is built there.
            case 'props': {
                // The checker's is bracketed in `lower` (`checkedPropsClose`).
                const defaulted = read.keys
                const writtenKeys: (string | undefined)[] = []
                for (const key of read.path)
                    if (key.name === undefined || !defaulted.includes(key.name))
                        writtenKeys.push(key.name)
                const record =
                    writtenKeys.length === 0
                        ? PROPS
                        : `${this.use('propCells')}(${PROPS}, ${JSON.stringify(writtenKeys)})`
                return defaulted.length === 0
                    ? record
                    : `${this.use('withoutKeys')}(${record}, ${JSON.stringify(defaulted)})`
            }
            // 33.4 again, on the other side of the `=`: every key is an accessor, so a default
            // has to be one too — bound as written, `currency` would be a string where every
            // read of it is a call. The two insertions BRACKET the author's expression rather
            // than replacing it, so a default that reads a `Reactive` still lowers inside. A
            // written prop's default is its cell, as the caller's value would have been.
            case 'defaultOpen': {
                if (this.checking)
                    return read.through
                        ? `${this.use('propCell')}(() => (`
                        : '() => ('
                const caller = `${this.use('propOr')}(${PROPS}[${JSON.stringify(read.keys[0])}], () => (`
                return read.through
                    ? `${this.use('propCell')}(${caller}`
                    : caller
            }
            case 'defaultClose':
                if (this.checking) return read.through ? '))' : ')'
                return read.through ? ')))' : '))'
            case 'absent':
                if (this.checking) return undefined
                return read.through
                    ? ` = ${this.use('propCell')}(() => undefined)`
                    : ' = () => undefined'
            // 32.25, 32.2 — THE TEMPLATE SPELLING `raw(x)` IS A CALL TO THE FRAMEWORK'S `raw`, the
            // export an app imports, so a value branded in a `<script>` and one branded in a
            // template are the same object. The read exists only where a template expression held
            // the call (`expressionFacts`), so a `<script>`'s `raw` stays the file's.
            case 'raw':
                return this.checking && this.importsRaw
                    ? undefined
                    : this.use('raw')
            // 27.13 — the call bound to a name, for the checker to read the defaults' type off.
            case 'config':
                return this.checking
                    ? `const ${CHECKED_CONFIG}${read.start} = ${CHECKED_CONFIG_OF}(${spelled})`
                    : undefined
        }
        const value =
            read.value === undefined ? '1' : this.lower(read.value).trim()
        if (read.path.length > 0) return this.pathWrite(read, name, value)
        // 31.4 — `n++`, `--n`. A statement discards the value and takes the short form — which is
        // not a saving but a requirement: the value-preserving form begins with `(`, and after a
        // line break JavaScript refuses to insert the semicolon in front of it, so `f()\nn++` would
        // have emitted a call on `f()`'s result. A read prefix is `n += 1`, worth what it stored;
        // only a read postfix binds what it read, which is what JavaScript hands back.
        const step = read.operator
        if (read.discarded) return `${name}.set(${name}() ${step} 1)`
        if (read.prefix) return writeParts(name, step, false).join(value)
        return `((${PREVIOUS}) => (${name}.set(${PREVIOUS} ${step} 1), ${PREVIOUS}))(${name}())`
    }

    /**
     * A whole-name write's two sides as the checker reads them, or `undefined` outside checking.
     *
     * 38.3 — A WRITE IS AN ASSIGNMENT TO WHAT A READ READS, where the checker is asked. Lowered to
     * `set`, it is a call, and a call does not undo a narrowing:
     * `if (x === null) { x = 3; x.toFixed() }` reads `x` as still `null`. Assigned, it narrows as
     * JavaScript's own `x = 3` does — and the value still goes through `CHECKED_WRITE`, held to
     * what `set` takes.
     */
    private checkedWriteParts(read: Read): [string, string] | undefined {
        if (!this.checking || read.local) return undefined
        const spelled = this.projection.text.slice(read.start, read.end)
        this.values.set(spelled, read.through)
        const held = `${CHECKED_VALUES}.${spelled}`
        const written = `${CHECKED_WRITE}(${this.nameOf(read)}, `
        const op = read.operator
        // A WRITE THAT IS A WHOLE STATEMENT MUST NOT OPEN ON `(`: after a line with no semicolon,
        // JavaScript reads it as a call on that line — `await f()` then `x = 1` checked as
        // `f()(...)`. `void` cannot continue a line, and unlike a leading `;` it stays one
        // statement under a braceless `if`.
        const open = read.discarded ? 'void (' : '('
        if (op === '') return [`${open}${held} = ${written}`, '))']
        if (SHORT_CIRCUIT.has(op))
            return [`${open}${held} ${op}= ${written}`, '))']
        return [`${open}${held} = ${written}${held} ${op} (`, ')))']
    }

    /** A read of the value: `name()`, or `__values.name` where the checker is asked. */
    private valueOf(spelled: string, read: Read, name: string): string {
        // A branch-local name is out of scope where the record is declared, and two bodies may
        // each declare one of the same spelling — it is called, and narrows as a call does.
        if (!this.checking || read.local) return `${name}()`
        this.values.set(spelled, read.through)
        return `${CHECKED_VALUES}.${spelled}`
    }

    /**
     * A write or update through a member path, lowered to a copy down the path and a `set`.
     *
     * 31.8 — A WRITE THROUGH A MEMBER PATH COPIES DOWN THE PATH AND THEN WRITES. Read as a plain
     * member, `user.name = 'x'` emits `user().name = 'x'`: the held object mutated in place, so
     * the value is right, no `set` is called, the identity never changes and not one reader
     * wakes. A SEGMENT IS EMITTED SOURCE RATHER THAN A NAME, because a computed one is an
     * expression and may itself be a read: `rows[i] = v` carries `i()`.
     */
    private pathWrite(read: Read, name: string, value: string): string {
        const segments: string[] = []
        for (const segment of read.path)
            segments.push(
                segment.name === undefined
                    ? this.lower(segment)
                    : JSON.stringify(segment.name),
            )
        // An op-assign or an update through a path READS the path first, the same way `n += 1`
        // reads `n`, and a SHORT-CIRCUITING one reads it to decide whether to write at all.
        const op = read.operator
        const current = `${name}()${segments.map((segment) => `[${segment}]`).join('')}`
        const short = SHORT_CIRCUIT.has(op)
        const writePath = `${this.use('writePath')}(${name}(), [${segments.join(', ')}], `
        // A POSTFIX UPDATE IS WORTH WHAT IT READ, and only it: every other write is worth what it
        // stored, as the whole-name forms are.
        if (!read.discarded && read.shape === 'update' && !read.prefix)
            return `((${PREVIOUS}) => (${name}.set(${writePath}${PREVIOUS} ${op} 1)), ${PREVIOUS}))(${current})`
        const stored =
            op === '' || short ? value : `${current} ${op} (${value})`
        const write = read.discarded
            ? `${name}.set(${writePath}${stored}))`
            : `((${STORED}) => (${name}.set(${writePath}${STORED})), ${STORED}))(${stored})`
        return short ? `${current} ${op} ${write}` : write
    }
}

function importsAbideRaw(file: AbideFile): boolean {
    for (const body of scriptBodies(file))
        for (const { name, specifier } of importedNames(body))
            if (name === 'raw' && specifier.startsWith('@abide/abide'))
                return true
    return false
}

function isRawCallee(read: Read): boolean {
    return read.shape === 'raw'
}

/**
 * A template position's text, parenthesized only where splicing it as written would change it.
 *
 * 19.11 — A TEMPLATE POSITION IS ONE EXPRESSION, and the emit splices it into an argument list, an
 * initializer or an arrow's body. So a top-level comma, a leading `{` (a block, as an arrow's
 * body) and a trailing line comment (which would comment out what the emit closes it with) are
 * parenthesized — and nothing else is, so the common slot is emitted as written.
 */
function grouped(text: string): string {
    if (!text.includes(',') && !text.includes('/') && text[0] !== '{')
        return text
    const tokens = tokenize(text)
    const last = tokens[tokens.length - 1]
    if (last !== undefined && last.end < text.trimEnd().length)
        return `(${text}\n)`
    if (tokens[0]?.kind === SyntaxKind.OpenBraceToken) return `(${text})`
    let depth = 0
    for (const token of tokens) {
        depth += nesting(token.kind)
        if (depth === 0 && token.kind === SyntaxKind.CommaToken)
            return `(${text})`
    }
    return text
}

/**
 * What the emitted component function calls its props record.
 *
 * Under `__` for the reason every framework name in an emitted module is (`importClause`): an
 * author's own `props` is a name they may have bound themselves.
 */
export const PROPS = '__props'

/** The record a checked lowering reads each value through (`Lowering.values`). */
export const CHECKED_VALUES = '__values'

/**
 * 27.13 — what a checked lowering binds an `onConfig(…)` statement to, suffixed by where the call
 * stands, and the declared function that hands that call back typed as what its defaults return.
 */
export const CHECKED_CONFIG = '__config'
export const CHECKED_CONFIG_OF = '__configOf'

/**
 * The checked lowering's write guard: holds a written value to what `set` takes.
 *
 * Hands the value back as its own type — or the value's, where `set` takes what a read never hands
 * back — for the assignment to narrow by.
 */
export const CHECKED_WRITE = '__written'

/**
 * What stands either side of the value in the write a name and an assignment operator stand for.
 *
 * 31.4 — THE SIXTEEN ARE ONE MECHANISM: the operator is the token's own text without its `=`, so
 * completeness is a property rather than a list.
 *
 * 31.4 — A WRITE IS WORTH WHAT IT STORED wherever its value is read, as JavaScript's `a = b = 0`
 * is: `set` hands back nothing, so the value is bound once and handed back beside the write. A
 * discarded write takes the short form, for the reason a discarded `n++` does.
 */
function writeParts(
    name: string,
    op: string,
    discarded: boolean,
): [string, string] {
    const open = discarded
        ? `${name}.set(`
        : `((${STORED}) => (${name}.set(${STORED}), ${STORED}))(`
    if (op === '') return [open, ')']
    if (SHORT_CIRCUIT.has(op)) return [`${name}() ${op} ${open}`, ')']
    return [`${open}${name}() ${op} (`, '))']
}

// What a read write binds: the value it stored, or — a postfix update — the value it read. Under
// `__` for the reason every framework name in an emitted module is (`importClause`).
const STORED = '__stored'
const PREVIOUS = '__previous'
