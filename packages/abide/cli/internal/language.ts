// The `.abide` language server, as a function of what an editor said.
//
// Nothing here opens a socket, reads a file, or knows it is attached to a process: the transport is
// two hooks — bytes in through `feed`, bytes out through `write` — the same shape `editor.ts` takes
// its terminal in, and for the same reason. A language server is the one part of this binary a
// spawned process cannot really drive: a claim about it is a claim about a CONVERSATION, and the way
// to make one is to hand it the conversation and read what came back.
//
// It answers two kinds of question, and the split is what the whole file is arranged around:
//
//   * What the SYNTAX says — a parse failure, which block a `{:else}` belongs to, what `bind:` can be
//     written on a `<select>`. All of it is `compile()` and the two tables the compiler already
//     exports, so it is pure, instant, and available on a half-typed file.
//   * What the TYPES say — an ordinary type error, the type under the cursor, the file a name was
//     declared in. That needs the real checker over a real program, which is I/O and another process,
//     so it arrives through optional hooks and a server built without them simply stays quiet.
//
// The completion and hover answers are DERIVED from `BRANCHES` and `BINDABLE` rather than from prose
// written beside them. Those two are the closed sets of the template language and the compiler
// decides them, so an editor cannot offer a block that does not exist or miss one that does — which
// is the same guarantee `/docs/syntax` gets, arrived at from the other end.

import { BINDABLE, BRANCHES, type BranchTail, compile, failedAt, placeAt, startsOf } from '#compiler/index.ts'
import { ENCODER } from '#shared/internal/ENCODER.ts'

/** Zero-based, and the character is a UTF-16 code unit — which is what a JS string index already is. */
interface Position {
    line: number
    character: number
}

export interface Range {
    start: Position
    end: Position
}

/** `1` error, `2` warning, `3` information, `4` hint — LSP's own numbering. */
export type Severity = 1 | 2 | 3 | 4

export interface Diagnostic {
    range: Range
    severity: Severity
    source: string
    message: string
    /** `TS2339` — what an editor shows beside the message, and what `abide check` already prints. */
    code?: string
}

/** One open buffer. `path` is what the compiler is told the file is called, so a diagnostic names it. */
interface Document {
    uri: string
    path: string
    text: string
    version: number
}

export interface LanguageHooks {
    /** One framed message, ready for the wire. */
    write(message: Uint8Array): void
    /**
     * What the real checker says about this buffer, already on the `.abide` line.
     *
     * Optional, and that is the degradation rather than a failure: a server with no checker behind it
     * still reports every parse error, still completes every block and still hovers every bind — it
     * just never contradicts the author about a type. Called per change; a caller that would rather
     * not run a program on every keystroke coalesces on its own side, and a reply that arrives after
     * the buffer moved on is dropped here.
     */
    types?(document: Document): Promise<Diagnostic[]>
    /**
     * The type of the expression at a position, for the hover the two tables cannot answer.
     *
     * Optional beside `types` and for the same reason: a server with no checker still hovers every
     * block and every bind. Asked only where a mapping EXISTS — inside a `{…}` or a `<script>` body,
     * which is what `askable` decides.
     */
    typeAt?(document: Document, line: number, character: number): Promise<Typed | null>
    /** Where the name at a position was declared, for the definitions the imports cannot answer. */
    definitionAt?(document: Document, line: number, character: number): Promise<Declared[]>
    /** The `exit` notification. The process is the shell's, so what to do with the code is too. */
    exit(code: number): void
}

/** What a checker says a hover is about. */
export interface Typed {
    type: string
    docs: string | null
}

/** A place in a file, 1-based — the shape `live.ts` answers a definition in. */
export interface Declared {
    path: string
    line: number
    column: number
    endLine: number
    endColumn: number
}

/**
 * `State<T>`, and the two names that extend it. Anchored, so a type that merely MENTIONS one — a
 * function returning a state, an object holding one — is not described as being one.
 */
const STATE_TYPE = /^(?:State|MemoHandle|Memo)<([\s\S]+)>$/

/**
 * What a state IS, said where an author meets it.
 *
 * `State` is the one public name in abide an author reads and never writes: the sugar is the whole
 * point, so a prop or a `state()` is used by name and the type behind it never had to be said out
 * loud — until a hover started saying it. The line below is that name connected back to the spelling
 * the author already knows, which is the same rule the compiler decides SYNTACTICALLY.
 */
function describeState(type: string, name: string | null): string {
    const match = STATE_TYPE.exec(type)
    if (match === null) return ''
    const subject = name ?? 'it'
    const held = match[1] as string
    return (
        `A **state** — a \`${held}\` that can CHANGE, and that tells whoever read it when it does. ` +
        `That is why it is not just a \`${held}\`: a plain value cannot say it moved.\n\n` +
        `In markup, write the name: \`{${subject}}\` — reading it is what subscribes, ` +
        `so it re-renders itself. In a \`<script>\`, \`${subject}\` reads and ` +
        `\`${subject}.set(…)\` writes.`
    )
}

/** The whole identifier the offset sits in, for a message that can name what it is about. */
function nameAt(text: string, offset: number): string | null {
    let start = offset
    while (start > 0 && NAME_CHARACTER.test(text[start - 1] as string)) start--
    let end = offset
    while (end < text.length && NAME_CHARACTER.test(text[end] as string)) end++
    const name = text.slice(start, end)
    return IDENTIFIER_NAME.test(name) ? name : null
}

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/

/** LSP's own: a file and a range in it. What `textDocument/definition` answers with. */
interface Location {
    uri: string
    range: Range
}

const DECODER = new TextDecoder()

/** The default settle window. Long enough to skip a word being typed, short enough to feel prompt. */
const SETTLE_MS = 150

/** A keyword after `{`, and where it is — the three spellings that open, branch and close a block. */
interface Marker {
    sigil: '#' | ':' | '/'
    /** The whole word as it currently stands, which on a half-typed marker is a prefix of one. */
    name: string
    /** Where the word begins — what a caller slices its prefix from, and where the `{` is, less two. */
    start: number
}

/** `bind:<target>` as an attribute name, plus the tag it is being written on when that is readable. */
interface Bound {
    name: string
    start: number
    tag: string | null
}

const LETTER = /[A-Za-z]/
const NAME_CHARACTER = /[\w$-]/

/**
 * The `{#…}` / `{:…}` / `{/…}` marker whose KEYWORD the offset sits in, or `null` for anywhere else.
 *
 * Read backwards from the cursor over letters and then forwards over the rest of the word, so one
 * function answers both questions asked of it: completion takes `text.slice(start, offset)` as the
 * prefix, and hover takes the whole `name`. An offset past the keyword — inside `{#if count > 1}`'s
 * condition — is not in a marker at all, which is why the start comes back rather than a bare name.
 */
function markerAt(text: string, offset: number): Marker | null {
    let start = offset
    while (start > 0 && LETTER.test(text[start - 1] as string)) start--
    const sigil = text[start - 1]
    if (sigil !== '#' && sigil !== ':' && sigil !== '/') return null
    if (text[start - 2] !== '{') return null
    let end = start
    while (end < text.length && LETTER.test(text[end] as string)) end++
    if (offset > end) return null
    return { sigil, name: text.slice(start, end), start }
}

/**
 * The blocks still open at `offset`, innermost LAST.
 *
 * Scanned out of the text rather than taken off the parse tree, and that is not a shortcut: the
 * instant an editor asks what may follow `{:` is the instant the file has an unclosed block in it and
 * does not parse at all. So this counts `{#name}` against `{/name}` and nothing else — it does not
 * know what a string is, and a `{#if}` written inside one would be counted. The cost of being wrong
 * is one wrong suggestion in a list, which is the trade a parse tree cannot make here.
 */
function openBlocksBefore(text: string, offset: number): string[] {
    const open: string[] = []
    const before = text.slice(0, offset)
    for (let at = before.indexOf('{'); at !== -1; at = before.indexOf('{', at + 1)) {
        const sigil = before[at + 1]
        if (sigil !== '#' && sigil !== '/') continue
        let end = at + 2
        while (end < before.length && LETTER.test(before[end] as string)) end++
        const name = before.slice(at + 2, end)
        if (name === '') continue
        if (sigil === '#') {
            if (BRANCHES[name] !== undefined) open.push(name)
            continue
        }
        // Popped only when it MATCHES, so a stray `{/if}` in a file being repaired does not take the
        // block that is genuinely open with it.
        if (open[open.length - 1] === name) open.pop()
    }
    return open
}

/**
 * The `bind:` attribute the offset sits in, and the tag it is on.
 *
 * The tag is the nearest `<name` behind the cursor with no `>` between, which is the same "no parse
 * tree available" rule the block scan states. `null` for a tag it could not read, and a null tag
 * means every target is offered rather than none — a suggestion list that goes empty on a shape this
 * cannot see is worse than one that is merely unfiltered.
 */
function boundAt(text: string, offset: number): Bound | null {
    let start = offset
    while (start > 0 && NAME_CHARACTER.test(text[start - 1] as string)) start--
    if (text.slice(start - 5, start) !== 'bind:') return null
    let end = start
    while (end < text.length && NAME_CHARACTER.test(text[end] as string)) end++
    if (offset > end) return null
    return { name: text.slice(start, end), start, tag: tagAround(text, start) }
}

/**
 * The COMPONENT whose tag name the offset sits in — `<Card>` or `</Card>` — or `null`.
 *
 * Capital-initial, which is `parseTag`'s own test for a component and not a second opinion about one.
 * A definition for this is answered SYNTACTICALLY, without the checker: a component reaches a
 * template through an import, and the import is right there in the file's own script. That matters
 * beyond speed — a tag name carries no source mapping at all (only expressions do), so the checker
 * lane cannot answer here even when it is running.
 */
function componentAt(text: string, offset: number): string | null {
    let start = offset
    while (start > 0 && NAME_CHARACTER.test(text[start - 1] as string)) start--
    let end = offset
    while (end < text.length && NAME_CHARACTER.test(text[end] as string)) end++
    if (offset > end) return null
    const name = text.slice(start, end)
    if (name === '' || !/^[A-Z]/.test(name)) return null
    const before = text[start - 1]
    if (before === '<') return name
    return before === '/' && text[start - 2] === '<' ? name : null
}

/**
 * Whether the checker may be asked about this position at all.
 *
 * The two places a `.abide` file carries a source mapping, and nothing else: inside a `{…}`, and
 * inside a `<script>` body. Everywhere else is markup — a tag name, an attribute name, the text
 * between elements — which has no segment, so a mapping asked for one answers with the nearest
 * expression BEFORE it on the same line rather than with nothing. That is the whole reason this
 * exists: an unbounded ask is not quiet when it is wrong, it is confidently about something else.
 *
 * The script arm was missing while a body had no segments to map, and its absence outlived the gap —
 * a hover over a `<script>` returned null having never asked, which is indistinguishable from a
 * checker that had nothing to say.
 */
function askable(text: string, offset: number): boolean {
    return holeAt(text, offset) !== null || inScript(text, offset)
}

/** `/g`, so `lastIndex` is reset at every entry — this is shared and `exec` carries state. */
const SCRIPT_BLOCK = /<script(\s[^>]*)?>/gi

/** Inside a `<script>`'s BODY — its tag and its closer are markup and are not. */
function inScript(text: string, offset: number): boolean {
    SCRIPT_BLOCK.lastIndex = 0
    for (;;) {
        const match = SCRIPT_BLOCK.exec(text)
        if (match === null) return false
        const start = match.index + match[0].length
        if (start > offset) return false
        const close = text.indexOf('</script>', start)
        const end = close === -1 ? text.length : close
        if (offset <= end) return true
        SCRIPT_BLOCK.lastIndex = end
    }
}

/**
 * The `{…}` hole the offset is INSIDE, as the range of its expression — or `null` anywhere else.
 *
 * The bound the type lane needs. A source mapping marks where an expression BEGINS and carries no
 * extent, so `generatedPosition` asked about a cursor in the markup after `{book.title}` answers with
 * a position inside that expression plus the distance to the cursor — a confident mapping into the
 * middle of something else. Scanned rather than parsed, for the reason `openBlocksBefore` gives: the
 * instant an editor asks is the instant the file has a half-typed block in it.
 *
 * A `{#…}` / `{:…}` / `{/…}` marker is NOT a hole. Their headers do carry expressions, but the block
 * lane already answers over them and it answers about the BLOCK, which is the more useful of the two.
 */
function holeAt(text: string, offset: number): { start: number; end: number } | null {
    let at = offset
    let depth = 0
    while (at > 0) {
        at--
        const character = text[at]
        if (character === '}') depth++
        else if (character === '{') {
            if (depth > 0) {
                depth--
                continue
            }
            const sigil = text[at + 1]
            if (sigil === '#' || sigil === ':' || sigil === '/') return null
            break
        } else if (character === '<' || character === '>') return null
    }
    if (text[at] !== '{') return null
    const start = at
    let close = offset
    let open = 0
    while (close < text.length) {
        const character = text[close]
        if (character === '{') open++
        else if (character === '}') {
            if (open === 0) return { start, end: close }
            open--
        }
        close++
    }
    return null
}

/** `import Card from './Card.abide'` — the specifier the name is bound by, or `null`. */
function importedFrom(text: string, name: string): string | null {
    IMPORT_STATEMENT.lastIndex = 0
    for (;;) {
        const match = IMPORT_STATEMENT.exec(text)
        if (match === null) return null
        // The CLAUSE is what binds, so `Card` in `import Cardigan from …` must not match. Split on
        // the punctuation a clause is made of rather than searched as a substring.
        for (const bound of (match[1] as string).split(/[\s,{}]+/)) {
            if (bound === name) return match[2] as string
        }
    }
}

const IMPORT_STATEMENT = /import\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"]/g

/**
 * A relative specifier as a path. Bare ones answer `null` — resolving those is the checker's job.
 *
 * `URL` does the `.` / `..` walk, which is the same argument `live.ts`'s `resolveFrom` makes against
 * path arithmetic: it is a normalisation with edge cases, and one is already written. Pure — no file
 * is opened, so this keeps the "asks the disk nothing" invariant the rest of this file holds to.
 */
function besidePath(from: string, specifier: string): string | null {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
    return Bun.fileURLToPath(new URL(specifier, `file://${from}`))
}

function tagAround(text: string, offset: number): string | null {
    for (let at = offset - 1; at >= 0; at--) {
        const character = text[at] as string
        if (character === '>') return null
        if (character !== '<') continue
        let end = at + 1
        while (end < text.length && NAME_CHARACTER.test(text[end] as string)) end++
        const name = text.slice(at + 1, end)
        return name === '' ? null : name
    }
    return null
}

/**
 * What a block is, said in the one thing the compiler actually knows about it: which branches it
 * takes. Written from `BRANCHES` so a sixth block documents itself the day it is added.
 */
function describeBlock(name: string): string {
    const branches = BRANCHES[name]
    if (branches === undefined) return ''
    const spelled: string[] = []
    for (const branch in branches) spelled.push(spellBranch(branch, branches[branch] as BranchTail))
    if (spelled.length === 0) return `\`{#${name}}\` … \`{/${name}}\``
    return `\`{#${name}}\` … \`{/${name}}\` — takes ${spelled.join(', ')}`
}

/**
 * A branch as an author writes it, BOTH ways when it may be written either.
 *
 * `{:else}` and `{:else if <condition>}` are one keyword, so a list of keywords could only ever show
 * the first — which is exactly what it did, and why `{:else if}` was undiscoverable from an editor
 * while being perfectly legal.
 */
function spellBranch(name: string, shape: BranchTail): string {
    if (shape.tail === '') return `\`{:${name}}\``
    const full = `\`{:${name} ${shape.tail}}\``
    return shape.optional ? `\`{:${name}}\` or ${full}` : full
}

/**
 * The same, for a bind target: which tags accept it, and which event writes back through each.
 *
 * PER TAG, because the event is per tag — `bind:value` settles on `input` for a text field and on
 * `change` for a `<select>`, and one event named for the whole row is a hover that is wrong about
 * two thirds of it.
 */
function describeBound(target: string): string {
    const accepted = BINDABLE[target]
    if (accepted === undefined) return ''
    const pairs: string[] = []
    for (const tag in accepted) {
        pairs.push(`\`<${tag}>\` on \`${(accepted[tag] as { event: string }).event}\``)
    }
    return `\`bind:${target}\` — hands over the state, and writes it back from ${pairs.join(', ')}`
}

/** A document, plus the line index both position directions need. */
class Held {
    /** Rebuilt on the next ask after an edit, because the text is the only thing that invalidates it. */
    private lines: number[] | null = null

    constructor(
        readonly uri: string,
        readonly path: string,
        public text: string,
        public version: number,
    ) {}

    edit(text: string, version: number): void {
        this.text = text
        this.version = version
        this.lines = null
    }

    document(): Document {
        return { uri: this.uri, path: this.path, text: this.text, version: this.version }
    }

    private starts(): number[] {
        this.lines ??= startsOf(this.text)
        return this.lines
    }

    positionAt(offset: number): Position {
        const { line, column } = placeAt(this.starts(), offset)
        return { line, character: column }
    }

    offsetAt(position: Position): number {
        const starts = this.starts()
        if (position.line < 0) return 0
        if (position.line >= starts.length) return this.text.length
        const at = (starts[position.line] as number) + position.character
        return at > this.text.length ? this.text.length : at
    }

    /** The range a diagnostic at `offset` gets: the run of non-space it starts, or one character. */
    rangeAt(offset: number): Range {
        let end = offset
        while (end < this.text.length && !/\s/.test(this.text[end] as string)) end++
        if (end === offset) end = Math.min(offset + 1, this.text.length)
        return { start: this.positionAt(offset), end: this.positionAt(end) }
    }
}

/** A `file://` URI as the path it names. Anything else is handed back as it came — `fileURLToPath` throws. */
function pathOf(uri: string): string {
    return uri.startsWith('file://') ? Bun.fileURLToPath(uri) : uri
}

interface Request {
    id?: number | string
    method?: string
    params?: Record<string, unknown>
}

export class LanguageServer {
    private readonly open = new Map<string, Held>()
    /** LSP's two-step goodbye: `exit` after a `shutdown` is a success, and on its own is not. */
    private asked = false
    /** The settle timer per open document, so an edit cancels the ask the last one scheduled. */
    private readonly settling = new Map<string, ReturnType<typeof setTimeout>>()
    /** Whatever of the current message has arrived. Bytes, because `Content-Length` counts bytes. */
    private held: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

    /**
     * `settle` is how long a buffer stops moving before `types` is asked. A parameter rather than a
     * constant so a test can drive the whole lane without waiting on a clock.
     */
    constructor(
        private readonly hooks: LanguageHooks,
        private readonly settle = SETTLE_MS,
    ) {}

    /** A chunk of the input stream. One chunk may hold part of a message, or several whole ones. */
    feed(chunk: Uint8Array<ArrayBufferLike>): void {
        this.held = this.held.length > 0 ? new Uint8Array(Bun.concatArrayBuffers([this.held, chunk])) : chunk
        for (;;) {
            const message = this.take()
            if (message === null) return
            this.receive(message)
        }
    }

    /** One whole message off the front of the buffer, or `null` while it is still arriving. */
    private take(): Request | null {
        const blank = headerEnd(this.held)
        if (blank === -1) return null
        const declared = /content-length:\s*(\d+)/i.exec(DECODER.decode(this.held.subarray(0, blank)))
        if (declared === null) {
            // A header block with no length in it cannot be measured, so nothing after it can be
            // found either. Dropping the whole buffer is the only resynchronisation there is.
            this.held = new Uint8Array(0)
            return null
        }
        // The header is ASCII, so its byte length is its character length — the BODY is what may not
        // be, and it is measured off the buffer rather than off the decoded text for exactly that.
        const from = blank + 4
        const length = Number(declared[1])
        if (this.held.length - from < length) return null
        const body = DECODER.decode(this.held.subarray(from, from + length))
        this.held = this.held.slice(from + length)
        try {
            return JSON.parse(body) as Request
        } catch {
            return null
        }
    }

    private receive(message: Request): void {
        const { id, method } = message
        const params = message.params ?? {}
        if (method === undefined) return

        if (id === undefined) {
            this.notified(method, params)
            return
        }
        switch (method) {
            case 'initialize':
                this.answer(id, CAPABILITIES)
                return
            case 'shutdown':
                this.asked = true
                this.answer(id, null)
                return
            case 'textDocument/completion':
                this.answer(id, this.completions(params))
                return
            case 'textDocument/hover':
                // Answered LATER when the two tables do not know: a type comes from a program in
                // another process. A request may be answered out of order and an editor matches on
                // the id, which is what makes this safe to do per request rather than in a queue.
                void this.hover(id, params)
                return
            case 'textDocument/definition':
                void this.definition(id, params)
                return
            default:
                // `-32601`, method not found. A request answered with NOTHING is a client waiting
                // forever, which is the one way a language server hangs an editor.
                this.fail(id, method)
        }
    }

    private notified(method: string, params: Record<string, unknown>): void {
        switch (method) {
            case 'textDocument/didOpen': {
                const item = params.textDocument as { uri: string; text: string; version?: number }
                const path = pathOf(item.uri)
                // The EXTENSION decides, not the client. A `.ts` file sent here by a misconfigured
                // editor would be parsed as markup — which quietly produces nothing — and then
                // EMITTED, which writes a `foo.ts.ts` into the mirror that nothing ever sweeps,
                // because the sweep only recognises what it wrote.
                if (!path.endsWith('.abide')) return
                const held = new Held(item.uri, path, item.text, item.version ?? 0)
                this.open.set(item.uri, held)
                this.report(held)
                return
            }
            case 'textDocument/didChange': {
                const item = params.textDocument as { uri: string; version?: number }
                const held = this.open.get(item.uri)
                if (held === undefined) return
                // Full sync — the whole buffer arrives on every edit, which is what `CAPABILITIES`
                // asks for. Incremental sync is a second copy of the document that drifts silently
                // when a range is misread, and a `.abide` file is a page rather than a compiler.
                const changes = params.contentChanges as { text: string }[]
                const last = changes[changes.length - 1]
                if (last === undefined) return
                held.edit(last.text, item.version ?? held.version + 1)
                this.report(held)
                return
            }
            case 'textDocument/didSave': {
                const item = params.textDocument as { uri: string }
                const held = this.open.get(item.uri)
                if (held !== undefined) this.report(held)
                return
            }
            case 'textDocument/didClose': {
                const item = params.textDocument as { uri: string }
                this.open.delete(item.uri)
                // The scheduled ask goes with it, or a closed document is still checked once and the
                // map keeps one timer per file ever opened.
                this.stopSettling(item.uri)
                // Emptied rather than left: a squiggle on a file nobody has open outlives the editor.
                this.publish(item.uri, [])
                return
            }
            case 'exit':
                this.hooks.exit(this.asked ? 0 : 1)
                return
            default:
                // Every other notification — `initialized`, `$/cancelRequest`, a client's own — is
                // ignored ON PURPOSE. A notification has no reply, so there is nothing to hang.
                return
        }
    }

    // --- what it answers ---------------------------------------------------

    /**
     * Publish what the syntax says now, and what the types say when they arrive.
     *
     * Two publishes rather than one, because the second one costs a program and the first costs a
     * parse: waiting for the checker to agree before showing an unclosed block would put every
     * instant answer behind the slowest one. The late half is dropped when the buffer has moved on —
     * a diagnostic list is about a VERSION, and one published against a newer text lands on lines
     * that are no longer there.
     */
    private report(held: Held): void {
        const syntax = this.syntax(held)
        this.publish(held.uri, syntax)
        if (this.hooks.types === undefined) return
        // A buffer that does not PARSE has nothing for a checker to say about it: there is no module
        // to emit, so the answer is empty and the round trip is a second compile of text already
        // known to fail. While somebody is typing, that is the common state rather than the odd one.
        if (syntax.length > 0) {
            this.stopSettling(held.uri)
            return
        }
        this.settleThenCheck(held)
    }

    /**
     * Ask the checker once the buffer stops moving.
     *
     * Here rather than in the shell, because this side is what owns the version and the uri: a shell
     * coalescing on its own kept a second registry of both, keyed differently, and never pruned. The
     * delay is nothing anybody sees on a parse error — that half is already published above — it is
     * how many programs get built while somebody types a word.
     */
    private settleThenCheck(held: Held): void {
        const { uri } = held
        this.stopSettling(uri)
        this.settling.set(
            uri,
            setTimeout(() => {
                this.settling.delete(uri)
                this.check(held)
            }, this.settle),
        )
    }

    private stopSettling(uri: string): void {
        const timer = this.settling.get(uri)
        if (timer === undefined) return
        clearTimeout(timer)
        this.settling.delete(uri)
    }

    /** The version is read HERE, at the ask, so a reply the buffer then overtakes is dropped. */
    private check(held: Held): void {
        const types = this.hooks.types
        if (types === undefined) return
        const version = held.version
        void types(held.document()).then(
            (found) => {
                if (held.version !== version || !this.open.has(held.uri)) return
                this.publish(held.uri, found)
            },
            () => {
                // A checker that could not run is not a claim about the file. Swallowed here rather
                // than reported as a diagnostic, which would put a squiggle on somebody's page for a
                // missing `node`.
            },
        )
    }

    private syntax(held: Held): Diagnostic[] {
        try {
            compile(held.text, { filename: held.path })
            return []
        } catch (error) {
            const at = failedAt(error)
            const message = error instanceof Error ? error.message : String(error)
            return [
                {
                    // A throw with no position in it is not a place in the file, so it goes at the
                    // top rather than being guessed at.
                    range: at === null ? held.rangeAt(0) : held.rangeAt(at),
                    severity: 1,
                    source: 'abide',
                    // `source` already says whose it is; the prefix said it twice.
                    message: message.startsWith('abide: ') ? message.slice('abide: '.length) : message,
                },
            ]
        }
    }

    /**
     * What may be typed here — the blocks, their branches, their closing marker, and the bind
     * targets. All four lists come off `BRANCHES` and `BINDABLE`, so the editor's idea of the
     * template language and the compiler's are the same object.
     */
    private completions(params: Record<string, unknown>): CompletionItem[] {
        const found = this.at(params)
        if (found === null) return []
        const { held, offset } = found

        const marker = markerAt(held.text, offset)
        if (marker !== null) {
            const prefix = held.text.slice(marker.start, offset)
            if (marker.sigil === '#') return blockItems(Object.keys(BRANCHES), prefix)
            const innermost = enclosingBlock(held.text, marker)
            if (innermost === undefined) return []
            if (marker.sigil === '/') return blockItems([innermost], prefix)
            return branchItems(innermost, prefix)
        }

        const bound = boundAt(held.text, offset)
        if (bound !== null) return boundItems(bound.tag, held.text.slice(bound.start, offset))
        return []
    }

    /**
     * What is under the cursor, in the order the answers get more expensive.
     *
     * The two tables first, because they are the compiler's own and cost a scan. The TYPE last,
     * because it costs a program — and only inside a `{…}`, which is both the only place a mapping
     * exists and the only place a type is what somebody is asking about.
     */
    private async hover(id: number | string, params: Record<string, unknown>): Promise<void> {
        const found = this.at(params)
        if (found === null) {
            this.answer(id, null)
            return
        }
        const { held, offset } = found

        const marker = markerAt(held.text, offset)
        const named =
            marker === null
                ? ''
                : marker.sigil === ':'
                  ? (enclosingBlock(held.text, marker) ?? '')
                  : marker.name
        const said = describeBlock(named)
        if (said !== '') {
            this.answer(id, { contents: { kind: 'markdown', value: said } })
            return
        }

        const bound = boundAt(held.text, offset)
        if (bound !== null) {
            const about = describeBound(bound.name)
            if (about !== '') {
                this.answer(id, { contents: { kind: 'markdown', value: about } })
                return
            }
        }

        this.answer(id, await this.typed(held, offset))
    }

    /** The checker's answer for a position, rendered — or `null` for anywhere it does not apply. */
    private async typed(
        held: Held,
        offset: number,
    ): Promise<{ contents: { kind: 'markdown'; value: string } } | null> {
        const typeAt = this.hooks.typeAt
        if (typeAt === undefined || !askable(held.text, offset)) return null
        const version = held.version
        let found: Typed | null
        try {
            const { line, character } = held.positionAt(offset)
            found = await typeAt(held.document(), line, character)
        } catch {
            // A checker that could not run is not a claim about the file — the same swallow `check`
            // makes, and for the same reason.
            return null
        }
        // The buffer moved while the program was being asked, so the answer is about text that is no
        // longer there. An empty hover is the honest one.
        if (found === null || held.version !== version) return null
        // The checker's answer for a position that is not an EXPRESSION: it falls back to the FILE,
        // and the file is the generated mirror — so a cursor on a comment was answered
        // `typeof import("…/.abide/types/…")`, a path the author never wrote naming a module they
        // cannot open. The emit keeps a comment-ONLY line unmarked, which is the ask this never has to
        // make; here is where the same answer arrives from a trailing comment on a line that IS
        // marked, and where it is refused whatever hook produced it.
        if (found.type.startsWith('typeof import(')) return null
        // A fenced block, so an editor renders the type in its own syntax rather than as prose. The
        // doc comment goes BELOW the fence, where markdown is what it already was.
        const fenced = `\`\`\`ts\n${found.type}\n\`\`\``
        const said: string[] = [fenced]
        const described = describeState(found.type, nameAt(held.text, offset))
        if (described !== '') said.push(described)
        if (found.docs !== null) said.push(found.docs)
        const value = said.join('\n\n')
        return { contents: { kind: 'markdown', value } }
    }

    /**
     * Where what is under the cursor was declared.
     *
     * A COMPONENT is answered from the file's own imports and nothing else — see `componentAt`: a tag
     * name carries no source mapping, so this is not a shortcut past the checker but the only lane
     * that can answer at all. Everything else goes to the checker, which can only answer inside a
     * `{…}` for the same reason.
     */
    private async definition(id: number | string, params: Record<string, unknown>): Promise<void> {
        const found = this.at(params)
        if (found === null) {
            this.answer(id, null)
            return
        }
        const { held, offset } = found

        const component = componentAt(held.text, offset)
        if (component !== null) {
            this.answer(id, this.whereComponent(held, component))
            return
        }

        const definitionAt = this.hooks.definitionAt
        if (definitionAt === undefined || !askable(held.text, offset)) {
            this.answer(id, null)
            return
        }
        const version = held.version
        let declared: Declared[]
        try {
            const { line, character } = held.positionAt(offset)
            declared = await definitionAt(held.document(), line, character)
        } catch {
            this.answer(id, null)
            return
        }
        if (held.version !== version) {
            this.answer(id, null)
            return
        }
        const out: Location[] = []
        for (const one of declared) {
            out.push({
                uri: `file://${one.path}`,
                range: {
                    start: { line: one.line - 1, character: one.column - 1 },
                    end: { line: one.endLine - 1, character: one.endColumn - 1 },
                },
            })
        }
        this.answer(id, out.length === 0 ? null : out)
    }

    /**
     * A component's own file: the `{#component}` that defines it here, or the import that brought it.
     *
     * The local define is looked for FIRST because it wins in the compiler too — an inline component
     * shadows nothing, but a file that defines one and imports the same name is answering about the
     * one the template actually renders.
     */
    private whereComponent(held: Held, name: string): Location[] | null {
        const define = new RegExp(`\\{#component\\s+${name}\\s*\\(`).exec(held.text)
        if (define !== null) {
            const at = define.index + define[0].indexOf(name)
            return [{ uri: held.uri, range: held.rangeAt(at) }]
        }
        const specifier = importedFrom(held.text, name)
        if (specifier === null) return null
        const path = besidePath(held.path, specifier)
        if (path === null) return null
        // The TOP of the file. A component's default export is what a tag renders, and finding where
        // that export sits means reading a file this server has not been given — which is the
        // checker's job, and the checker cannot be asked about a tag name.
        return [
            {
                uri: `file://${path}`,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
        ]
    }

    /** The buffer a position request names, and where in it — `null` for a file nobody opened. */
    private at(params: Record<string, unknown>): { held: Held; offset: number } | null {
        const item = params.textDocument as { uri: string } | undefined
        const position = params.position as Position | undefined
        if (item === undefined || position === undefined) return null
        const held = this.open.get(item.uri)
        if (held === undefined) return null
        return { held, offset: held.offsetAt(position) }
    }

    // --- the wire ----------------------------------------------------------

    private answer(id: number | string, result: unknown): void {
        this.send({ jsonrpc: '2.0', id, result })
    }

    private fail(id: number | string, method: string): void {
        this.send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `abide lsp: no answer for \`${method}\`` },
        })
    }

    private publish(uri: string, diagnostics: Diagnostic[]): void {
        this.send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
    }

    private send(message: unknown): void {
        const body = ENCODER.encode(JSON.stringify(message))
        const header = ENCODER.encode(`Content-Length: ${body.length}\r\n\r\n`)
        this.hooks.write(new Uint8Array(Bun.concatArrayBuffers([header, body])))
    }
}

/**
 * Where a message's header block ends, in BYTES.
 *
 * Scanned as bytes rather than off a decoded string, because the body after it may be anything at
 * all: decoding the whole buffer to find four ASCII characters is the file's own text walked twice
 * per keystroke, and a chunk that split a multi-byte character would decode as a replacement.
 */
function headerEnd(bytes: Uint8Array): number {
    for (let at = 0; at + 3 < bytes.length; at++) {
        if (bytes[at] === 13 && bytes[at + 1] === 10 && bytes[at + 2] === 13 && bytes[at + 3] === 10) {
            return at
        }
    }
    return -1
}

/**
 * The block a `{:branch}` or `{/close}` belongs to — the keyword alone does not say, and `catch` is
 * on two.
 *
 * The stack is read up to the marker's own `{`, which is `start` less the sigil and the brace:
 * counting the marker being typed would find the block being WRITTEN as the one that is open. One
 * function, so that convention is written once.
 */
function enclosingBlock(text: string, marker: Marker): string | undefined {
    const enclosing = openBlocksBefore(text, marker.start - 2)
    return enclosing[enclosing.length - 1]
}

/** LSP's `CompletionItemKind.Keyword`. A block name is a fixed word, not a symbol to look up. */
const KEYWORD = 14

interface CompletionItem {
    label: string
    kind: number
    detail: string
}

function blockItems(names: string[], prefix: string): CompletionItem[] {
    const items: CompletionItem[] = []
    for (const name of names) {
        if (!name.startsWith(prefix)) continue
        items.push({ label: name, kind: KEYWORD, detail: describeBlock(name) })
    }
    return items
}

function branchItems(block: string, prefix: string): CompletionItem[] {
    const branches = BRANCHES[block]
    if (branches === undefined) return []
    const items: CompletionItem[] = []
    for (const branch in branches) {
        if (!branch.startsWith(prefix)) continue
        items.push({
            label: branch,
            kind: KEYWORD,
            detail: spellBranch(branch, branches[branch] as BranchTail),
        })
    }
    return items
}

/**
 * The bind targets that can be written where the cursor is.
 *
 * Filtered by the tag when the tag accepts any of them, and unfiltered otherwise — a `<div>` accepts
 * none, and a component accepts whatever it declares, which is not a question this table can answer.
 */
function boundItems(tag: string | null, prefix: string): CompletionItem[] {
    const names = Object.keys(BINDABLE)
    let allowed = names
    if (tag !== null) {
        const accepted: string[] = []
        for (const name of names) {
            if ((BINDABLE[name] as Record<string, unknown>)[tag] !== undefined) accepted.push(name)
        }
        if (accepted.length > 0) allowed = accepted
    }
    const items: CompletionItem[] = []
    for (const name of allowed) {
        if (!name.startsWith(prefix)) continue
        items.push({ label: name, kind: KEYWORD, detail: describeBound(name) })
    }
    return items
}

/**
 * What this server says it can do — and every entry is one somebody has to be able to switch off by
 * deleting a method above, so there is nothing advertised here that is not answered.
 *
 * `change: 1` is FULL sync; see `didChange`. The trigger characters are the three marker sigils and
 * the `:` that ends `bind:`, which is the same `:` — so the list is three characters for four
 * answers.
 */
const CAPABILITIES = {
    capabilities: {
        textDocumentSync: { openClose: true, change: 1, save: true },
        completionProvider: { triggerCharacters: ['#', ':', '/'] },
        hoverProvider: true,
        definitionProvider: true,
    },
    serverInfo: { name: 'abide' },
}
