import { SyntaxKind } from 'typescript/unstable/ast'
import type { Read } from './classifyRead.ts'
import type { AbideFile } from './parseAbide.ts'
import { type Projection, projectShadow, type Span } from './projectShadow.ts'
import { type Token, tokenise } from './tokenise.ts'

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
// THE READ STANDS IN FRONT AND NOTHING WRAPS IT. A parenthesised `(n() || n.set(v))` reads as a
// call on the line above it — ASI refuses to break in front of a `(` — and the operator binds
// looser than everything an author can legally write around an assignment, so the bare form needs
// no parentheses to survive one.
const SHORT_CIRCUIT: ReadonlySet<string> = new Set(['||', '&&', '??'])

// 34.3's keyword, spelled once for the guard below.
const AWAIT = 'await'

// ONE FILE'S LOWERING. Every piece the emitters ask for — a script, a slot, a subject, a key — is a
// SPAN of the projection, and a nested value (the right of a write, a computed path segment) is a
// span of the same text lowered by the same splice. `used` collects the framework names the
// rewrite EMITTED, so the import goes with the call; left to the callers it is one `used.add` per
// call site and a missed one emits a module calling a name it never imported.
export class Lowering {
    readonly projection: Projection
    readonly used = new Set<string>()
    // Ascending by `start`, so a span with none in it is one binary search.
    readonly reads: readonly Read[]

    constructor(file: AbideFile, reads: readonly Read[]) {
        this.projection = projectShadow(file)
        this.reads = reads
    }

    // 33 — WHETHER THIS FILE IS A COMPONENT THAT TAKES PROPS, which is the one thing the emitters
    // need from the props pass: the emitted function takes the record, and a file that never
    // calls `props` takes none (33.2).
    takesProps(): boolean {
        for (const read of this.reads) if (read.shape === 'props') return true
        return false
    }

    // 10.5 — WHETHER THIS FILE OPENS A SHARE SCOPE, which is the one thing the emitters need from
    // 10: a component that calls `reactive.share` gets a scope of its own, and one that does not
    // is a link a descendant's walk passes through. So two `<Shelf/>` each hold their own `queued`
    // and a `<TrackRow/>` finds the page's `nowPlaying` — with no node, and nothing to pay, on
    // every file that shares nothing.
    //
    // 10.2 IS CHECKED IN THE SAME SCAN: the key is a literal or it is a build error. Found by
    // SPELLING, as `raw` is — a file that binds its own `reactive` is not something the token walk
    // can see, and that is the same limit 32.26 already carries.
    opensShareScope(): boolean {
        const text = this.projection.text
        if (!text.includes('.share')) return false
        const tokens = tokenise(text)
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

    // A framework name as emitted code calls it, registered for the import in the same breath —
    // which is the whole reason it is one call. See `importClause` for the alias.
    use(name: string): string {
        this.used.add(name)
        return `__${name}`
    }

    // The `<script module>` blocks and the `<script>` blocks, each joined as the file wrote them.
    modules(): string {
        return this.lower(this.projection.modules, false)
    }

    scripts(): string {
        return this.lower(this.projection.scripts, false)
    }

    // A template expression. 32.26 — a SLOT's `raw(x)` lowers to the framework's own `raw`, which
    // is why the markup-writing holders (an expression, an attribute value) ask for it and a
    // subject, a key and a listener do not.
    slot(holder: object): string {
        const span = this.spanOf(holder)
        this.refuseAwait(span)
        return this.lower(span, true)
    }

    expression(holder: object): string {
        const span = this.spanOf(holder)
        this.refuseAwait(span)
        return this.lower(span, false)
    }

    // 31.3 — A `bind:` OPERAND HOLDS THE `Reactive`, which is the one template position where a
    // bare name is not a read: `bind:element={field}` puts the node IN the value, so lowering it
    // to `field()` hands the binding whatever the value happens to be instead.
    //
    // ONLY THE OPERAND ITSELF. A name nested anywhere inside — the write in
    // `bind:element={(node) => { tag = node.tagName }}` — is an ordinary position and is lowered
    // as one, which is why this is the same walk with one read left alone rather than the source
    // passed through.
    reference(holder: object): string {
        const span = this.spanOf(holder)
        this.refuseAwait(span)
        return this.lower(span, false, true)
    }

    key(block: object): string {
        const span = this.projection.keys.get(block)
        if (span === undefined)
            throw new Error('abide: a {#for} key was never projected.')
        return this.lower(span, false)
    }

    // WHETHER AN EXPRESSION READS A `Reactive` AT ALL, which is not the same question as whether the
    // rewrite changed it — `{n()}` and `{n.busy()}` are spellings it leaves exactly as written
    // (31.7, 31.5), and a run judged by the diff was dropped as static and never moved again.
    readsIn(holder: object): boolean {
        const span = this.spanOf(holder)
        const at = this.firstRead(span.start)
        return (
            at < this.reads.length && (this.reads[at] as Read).start < span.end
        )
    }

    // A TEMPLATE POSITION CANNOT `await`, and it is worth refusing rather than emitting. Every
    // slot, subject and attribute value is lowered into an ordinary arrow inside the markup
    // concatenation — there is no `async` for an `await` to belong to — so `{await rows}` emitted a
    // module that DOES NOT PARSE, reported by bun against the emitted file rather than the page.
    //
    // UNLESS THE SLOT MAKES ITS OWN, which is the half the first draft of this got wrong and
    // REGRESSED: `onclick={async () => await save()}` is an ordinary handler, the `await` belongs
    // to the arrow the author wrote, and refusing it broke a shape that had always worked.
    //
    // THE TEST IS `async` BEFORE `await` IN THE SAME SLOT, and that is a SUMMARY of the source
    // rather than its structure — so state what it lets through: a slot holding both an async
    // function AND a bare `await` of its own passes here and fails at the bundler, exactly as it
    // did before this guard existed. Depth cannot do better on its own — `{(await a) + 1}` is
    // illegal at paren depth 1 and `{xs.map(async (x) => await f(x))}` is legal at depth 2 — and
    // the structural answer needs the checker's tree, which this file does not have.
    private refuseAwait(span: Span): void {
        const source = this.projection.text.slice(span.start, span.end)
        if (!source.includes(AWAIT)) return
        for (const token of tokenise(source)) {
            if (token.text === 'async') return
            if (token.text !== AWAIT) continue
            throw new Error(
                `abide: a template position cannot await, and \`${source.trim()}\` does. A slot is lowered into an ordinary function, so there is nothing here to await in — await inside a handler or a reactive body, or read the value and let the position fill. RULEBOOK 34.3.`,
            )
        }
    }

    private spanOf(holder: object): Span {
        const span = this.projection.slots.get(holder)
        if (span === undefined)
            throw new Error('abide: a template expression was never projected.')
        return span
    }

    // The index of the first read starting at or after `offset`.
    private firstRead(offset: number): number {
        let low = 0
        let high = this.reads.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if ((this.reads[middle] as Read).start < offset) low = middle + 1
            else high = middle
        }
        return low
    }

    // The source from `from` to `to`, every read in it rewritten. A write's value and a computed
    // segment are spans inside it, lowered by the same call, and the reads they hold are skipped
    // by the outer walk because it resumes past them.
    private lower(span: Span, raw: boolean, holds = false): string {
        const from = span.start
        const to = span.end
        const source = this.projection.text
        // 31.3's position, as a span: the operand with its whitespace off, so a read covering
        // exactly that is the name standing alone.
        const text = source.slice(from, to)
        const wholeFrom = from + (text.length - text.trimStart().length)
        const wholeTo = from + text.trimEnd().length
        const calls = raw ? this.rawCalls(from, to) : NO_CALLS
        let read = this.firstRead(from)
        let call = 0
        if (
            call === calls.length &&
            (read === this.reads.length ||
                (this.reads[read] as Read).start >= to)
        )
            return source.slice(from, to)

        let out = ''
        let at = from
        while (true) {
            const next = this.reads[read]
            const readAt =
                next !== undefined && next.start < to ? next.start : to
            const callAt = call < calls.length ? (calls[call] as number) : to
            if (readAt === to && callAt === to) break
            if (callAt < readAt) {
                call += 1
                if (callAt < at) continue
                out += source.slice(at, callAt) + this.use('raw')
                at = callAt + 'raw'.length
                continue
            }
            read += 1
            const current = next as Read
            if (current.start < at) continue
            // 31.3 — the operand's own read is the one that does not lower.
            if (holds && current.from === wholeFrom && current.to === wholeTo)
                continue
            const rewritten = this.rewrite(current, raw)
            if (rewritten === undefined) continue
            out += source.slice(at, current.from) + rewritten
            at = current.to
        }
        return out + source.slice(at, to)
    }

    // What one read lowers to, or `undefined` where it stays exactly as written.
    private rewrite(read: Read, raw: boolean): string | undefined {
        const name = this.projection.text.slice(read.start, read.end)
        switch (read.shape) {
            case 'asWritten':
                return undefined
            // 31.7 — the explicit spelling keeps compiling. 31.11 — AND IT TAKES NO ARGUMENTS.
            // Passed through, `count(5)` calls the read with a value the read ignores: an author
            // who meant a write, silently given one.
            case 'call':
                if (read.arguments > 0)
                    throw new Error(
                        `abide: ${name}() is a read by name and takes no arguments, and this one is given one. Write ${name}.set(…) to write it. RULEBOOK 31.11.`,
                    )
                return undefined
            // 31.1 — a read. A member that is not the `Reactive`'s own reaches the value (31.5,
            // 31.6), so `regions.join(', ')` reads first and `n?.x` reads `n()?.x`.
            case 'value':
                return `${name}()`
            // AN OBJECT SHORTHAND IS A KEY AND A VALUE. `{ n }` means `{ n: n }`, so the key has
            // to stay `n` and only the value lowers — `{ n() }` is a method with no body.
            case 'shorthand':
                return `${name}: ${name}()`
            // 33.4 — the call IS the record of accessors the caller passed, so the pattern an
            // author wrote destructures that rather than a value nothing has.
            case 'props':
                return PROPS
            // 33.4 again, on the other side of the `=`: every key is an accessor, so a default
            // has to be one too — bound as written, `currency` would be a string where every
            // read of it is a call. The two insertions BRACKET the author's expression rather
            // than replacing it, so a default that reads a `Reactive` still lowers inside.
            case 'defaultOpen':
                return '() => ('
            case 'defaultClose':
                return ')'
        }
        const value =
            read.value === undefined ? '1' : this.lower(read.value, raw).trim()
        if (read.path.length > 0) return this.pathWrite(read, name, value, raw)
        if (read.shape === 'write') return writeOf(name, read.operator, value)
        // 31.4 — `n++`, `--n`. The read is bound once so a postfix can hand back what it read,
        // which is what JavaScript hands back; a statement discards it and takes the short form —
        // which is not a saving but a requirement: the value-preserving form begins with `(`, and
        // after a line break JavaScript refuses to insert the semicolon in front of it, so
        // `f()\nn++` would have emitted a call on `f()`'s result.
        const step = read.operator
        if (read.discarded) return `${name}.set(${name}() ${step} 1)`
        return `((__previous) => (${name}.set(__previous ${step} 1), ${
            read.prefix ? `__previous ${step} 1` : '__previous'
        }))(${name}())`
    }

    // 31.8 — A WRITE THROUGH A MEMBER PATH COPIES DOWN THE PATH AND THEN WRITES. Read as a plain
    // member, `user.name = 'x'` emits `user().name = 'x'`: the held object mutated in place, so
    // the value is right, no `set` is called, the identity never changes and not one reader
    // wakes. A SEGMENT IS EMITTED SOURCE RATHER THAN A NAME, because a computed one is an
    // expression and may itself be a read: `rows[i] = v` carries `i()`.
    private pathWrite(
        read: Read,
        name: string,
        value: string,
        raw: boolean,
    ): string {
        const segments: string[] = []
        for (const segment of read.path)
            segments.push(
                segment.name === undefined
                    ? this.lower(segment, raw)
                    : JSON.stringify(segment.name),
            )
        // An op-assign or an update through a path READS the path first, the same way `n += 1`
        // reads `n`, and a SHORT-CIRCUITING one reads it to decide whether to write at all.
        const op = read.operator
        const current = `${name}()${segments.map((segment) => `[${segment}]`).join('')}`
        const short = SHORT_CIRCUIT.has(op)
        const stored =
            op === '' || short ? value : `${current} ${op} (${value})`
        const write = `${name}.set(${this.use('writePath')}(${name}(), [${segments.join(', ')}], ${stored}))`
        return short ? `${current} ${op} ${write}` : write
    }

    // 32.26, 32.2 — THE SLOT SPELLING `raw(x)` IS A CALL TO THE FRAMEWORK'S `raw`, the export an
    // app imports, so a value branded in a `<script>` and one branded in a slot are the same
    // object. A member (`markdown.raw(x)`) is that object's own method, and a bare `raw` that is
    // not called is whatever the file bound. Found by spelling, so it holds with no checker too.
    private rawCalls(from: number, to: number): number[] {
        const text = this.projection.text.slice(from, to)
        if (!text.includes('raw')) return NO_CALLS
        const calls: number[] = []
        const tokens = tokenise(text)
        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i] as Token
            if (token.kind !== SyntaxKind.Identifier || token.text !== 'raw')
                continue
            const previous = tokens[i - 1]?.kind
            if (
                previous === SyntaxKind.DotToken ||
                previous === SyntaxKind.QuestionDotToken ||
                tokens[i + 1]?.kind !== SyntaxKind.OpenParenToken
            )
                continue
            // A `Reactive` the page named `raw` is a read, and the read's rewrite is the answer.
            const offset = from + token.start
            const read = this.reads[this.firstRead(offset)]
            if (read !== undefined && read.start === offset) continue
            calls.push(offset)
        }
        return calls
    }
}

const NO_CALLS: number[] = []

// What the emitted component function calls its props record. Under `__` for the reason every
// framework name in an emitted module is (`importClause`): an author's own `props` is a name they
// may have bound themselves.
export const PROPS = '__props'

// 31.4 — the write a name and an assignment operator stand for. THE SIXTEEN ARE ONE MECHANISM:
// the operator is the token's own text without its `=`, so completeness is a property rather
// than a list.
function writeOf(name: string, op: string, value: string): string {
    if (op === '') return `${name}.set(${value})`
    if (SHORT_CIRCUIT.has(op)) return `${name}() ${op} ${name}.set(${value})`
    return `${name}.set(${name}() ${op} (${value}))`
}
