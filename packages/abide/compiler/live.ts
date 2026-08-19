// Type errors for a buffer somebody is still typing into.
//
// `abide check` is the same three steps — emit the module the checker can resolve, run the checker,
// move every diagnostic back onto the `.abide` line — and it is shaped for a shell: it emits every
// file under a root, runs `tsc` over the whole project and prints lines. That is seconds, and an
// editor asks per keystroke. So the three steps are the same and each is narrowed to ONE file: the
// buffer is emitted rather than the tree, a program held open answers rather than a fresh `tsc`, and
// what comes back is a place rather than a line of text.
//
// The buffer and not the file, and that is the point: an editor's text is one save ahead of the disk,
// so a checker reading the disk reports the previous version's errors with total confidence. The
// mirror under `.abide/types` is generated and gitignored, so writing the unsaved text into it costs
// nothing that was not already being rewritten by every `abide check`.
//
// What it does NOT do is read anybody else's unsaved buffer: a `.ts` file the author is also editing
// is read from disk, because `.ts` is the TypeScript extension's business and this one is about
// `.abide`. The seam is the file extension, which is the one an editor already draws.

import { STREAMING } from '#shared/internal/STREAMING.ts'
import { type EmitResult, emitModule, placeIn, positionIn, sourceFor } from './check.ts'
import { compile, type Segment } from './index.ts'
import { identifierAt } from './internal/identifierAt.ts'
import { configAbove } from './internal/project.ts'

/** A diagnostic where it belongs — on the `.abide` file, 1-based, the numbering `abide check` prints. */
export interface Placed {
    line: number
    column: number
    endLine: number
    endColumn: number
    /**
     * `0` warning, `1` error, `2` suggestion, `3` message — the CHECKER's numbering, carried through
     * rather than translated. A caller renders it, and there is only one table to keep in step.
     */
    category: number
    /** The `TS2339` beside the message, which is what `abide check` prints and an editor shows. */
    code: number
    message: string
}

/** One line to the child — the same shape `internal/diagnosed.ts` reads off the other end. */
interface Asked {
    tsconfig: string
    file: string
    kind?: 'type' | 'definition'
    line?: number
    character?: number
    name?: string | undefined
}

/** What the type under a cursor is, and whatever was written above the thing it belongs to. */
export interface Typed {
    type: string
    docs: string | null
}

/**
 * Where a name was declared — already on the `.abide` line when the declaration was in one.
 *
 * 1-based, like `Placed`, because it is the same journey: the checker answers about a generated
 * module and this is that answer moved back onto a file somebody wrote. `path` is what makes it worth
 * a type of its own — a definition may leave the buffer entirely, for another `.abide` or for an
 * ordinary `.ts`, and only the first of those goes back through a source map.
 */
export interface Located {
    path: string
    line: number
    column: number
    endLine: number
    endColumn: number
}

/** What the child answers with: places in the WRITTEN module, which it counted with its own line map. */
interface Answer {
    diagnostics?: {
        line: number
        character: number
        endLine: number
        endCharacter: number
        category: number
        code: number
        text: string
    }[]
    type?: string | null
    docs?: string | null
    definitions?: {
        file: string
        line: number
        character: number
        endLine: number
        endCharacter: number
    }[]
    error?: string
}

const DECODER = new TextDecoder()

export interface LiveOptions {
    /**
     * Somewhere for the one thing that is worth saying out loud: the checker could not be started, or
     * could not open the project. Everything else is a diagnostic or nothing, and a language server
     * has no console to print to.
     */
    log?: (text: string) => void
}

/**
 * A checker, held open.
 *
 * One child process for the whole session and one ask in flight at a time — the protocol is a line
 * in and a line out in order, so two overlapping asks would read each other's answers. Serialised
 * here rather than by the caller, because the caller is an editor and an editor has no idea what
 * else is being asked.
 */
export class LiveCheck {
    private child: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | null = null
    private reading: ReadableStreamDefaultReader<Uint8Array> | null = null
    /** Whatever of the child's next line has arrived. Lines are one JSON object and are short. */
    private held = ''
    /** The tail of the ask queue, so the next exchange starts after the last one finished. */
    private tail: Promise<unknown> = Promise.resolve()
    /** Set once the checker has failed to start. Nothing retries after that — see `start`. */
    private gone = false

    constructor(private readonly options: LiveOptions = {}) {}

    /**
     * What the checker says about `text` as the contents of `path`.
     *
     * Empty for every reason that is not a type error: a file that does not compile (the caller's
     * own parse pass already said so, and a cascade of errors in a module that was never emitted is
     * noise), a tree with no `tsconfig.json` over it, and a checker that could not be started.
     *
     * The climb and the emit are independent, so they go together — the climb is memoised and the
     * emit is not, and on the first ask of a session neither should wait on the other.
     */
    async of(path: string, text: string): Promise<Placed[]> {
        const ready = await this.prepared(path, text)
        if (ready === null) return []
        const { tsconfig, emitted } = ready
        const answer = await this.ask({ tsconfig, file: emitted.module })
        if (answer === null) return []
        if (answer.error !== undefined) {
            // Said out loud rather than swallowed: a project the child cannot open answers this on
            // every ask, and the caller would otherwise see a file with no type errors — for ever,
            // and indistinguishable from a clean one.
            this.say(`abide lsp: the checker refused — ${answer.error}`)
            return []
        }
        if (answer.diagnostics === undefined) return []
        return placed(emitted, answer.diagnostics)
    }

    /**
     * The TYPE of the expression at a `.abide` position, or `null` for a position that has none.
     *
     * `null` covers everything the checker was never asked about, and the caller is what decides
     * which positions those are: only a template EXPRESSION carries a source mapping, so a cursor in
     * markup maps to whatever expression precedes it on the same line rather than to nothing. See
     * `positionIn` — the map is anchored per expression and has no extent, so it cannot say a
     * position is past the end of one. The language server bounds the ask to the inside of a `{…}`
     * before it is made.
     */
    async typeAt(path: string, text: string, line: number, character: number): Promise<Typed | null> {
        const answer = await this.at(path, text, line, character, 'type')
        if (answer === null) return null
        const { type } = answer.answer
        if (type === undefined || type === null) return null
        return { type, docs: answer.answer.docs ?? null }
    }

    /**
     * Where the name at a `.abide` position was declared, on the line of whatever file declares it.
     *
     * A definition that landed in the mirror is moved back onto its own `.abide` — which means
     * COMPILING that file, because the segments that map it are the ones its own emit produced and
     * this session only holds the buffer's. That is a compile per click on a component, which is the
     * right side of the trade: it is a keystroke that costs nothing and a click that costs one parse.
     * A definition in an ordinary `.ts` is handed back untouched — it was never generated, so there is
     * nothing to map it through.
     */
    async definitionAt(path: string, text: string, line: number, character: number): Promise<Located[]> {
        // An IMPORT is answered FIRST and without the checker. It is the one statement with no
        // position of its own — lifted to the top of the emitted module and MERGED with the emitter's
        // own, so an author's `import { state } from 'abide'` joins the `html` the header already
        // imports and there is no single place in the output to map it back from. What an import
        // names is a specifier and a file, which is a question about text: no emit, no program, no
        // wait.
        const named = this.imported(path, text, line, character)
        if (named.length > 0) return named

        const answer = await this.at(path, text, line, character, 'definition')
        if (answer === null) return []
        const found = answer.answer.definitions
        if (found === undefined) return []
        const out: Located[] = []
        for (const one of found) {
            const placed = await this.onSource(one, answer.emitted)
            if (placed !== null) out.push(placed)
        }
        return out
    }

    /**
     * The file an `import` at this position names, as the one place to be sent.
     *
     * The TOP of that file rather than the declaration inside it: finding where `state` is declared in
     * `abide.ts` is a question about a module this session was never asked to open, and the answer an
     * author wants from an import is overwhelmingly the file. `Bun.resolveSync` is what decides it, so
     * a bare specifier, a relative one and a `#`-prefixed subpath import all resolve the way the
     * runtime resolves them rather than the way a regex would guess.
     */
    private imported(path: string, text: string, line: number, character: number): Located[] {
        const offset = offsetOf(text, line, character)
        const specifier = importedAt(text, offset)
        if (specifier === null) return []
        const resolved = resolveFrom(path, specifier)
        return resolved === null ? [] : [{ path: resolved, line: 1, column: 1, endLine: 1, endColumn: 1 }]
    }

    /** One position ask, with the `.abide` position already mapped into the module. */
    private async at(
        path: string,
        text: string,
        line: number,
        character: number,
        kind: 'type' | 'definition',
    ): Promise<{ answer: Answer; emitted: EmitResult } | null> {
        const ready = await this.prepared(path, text)
        if (ready === null) return null
        const spot = positionIn(ready.emitted.segments, line, character)
        if (spot === null) return null
        const answer = await this.ask({
            tsconfig: ready.tsconfig,
            file: ready.emitted.module,
            kind,
            line: spot.line,
            character: spot.column,
            // What the cursor is ON, so the child can check the mapping did not land on a name the
            // emitter wrote instead — see `identifierAt` there.
            name: identifierAt(text, offsetOf(text, line, character)),
        })
        if (answer === null || answer.error !== undefined) return null
        return { answer, emitted: ready.emitted }
    }

    /**
     * A place the checker named, as a place in a file somebody wrote.
     *
     * Three cases, and the middle one is the whole reason this is not a one-liner: the buffer's own
     * module (map through the segments already held), another `.abide`'s module (compile it for its
     * segments), and anything else (a real file — hand it back as it came, converted to 1-based).
     */
    private async onSource(
        found: NonNullable<Answer['definitions']>[number],
        here: EmitResult,
    ): Promise<Located | null> {
        const segments = found.file === here.module ? here.segments : await segmentsForModule(found.file)
        if (segments === null) {
            return {
                path: found.file,
                line: found.line + 1,
                column: found.character + 1,
                endLine: found.endLine + 1,
                endColumn: found.endCharacter + 1,
            }
        }
        const source = found.file === here.module ? here.source : (sourceFor(found.file) as string)
        const start = placeIn(segments, found.line, found.character)
        // A declaration with no mapping is code the emitter WROTE — the component wrapper, an import
        // it added. Dropped rather than pointed at, for the reason `placed` below gives: an author
        // cannot act on a position in a file they never typed.
        if (start === null) return null
        const end = placeIn(segments, found.endLine, found.endCharacter)
        return {
            path: source,
            line: start.line,
            column: start.column,
            endLine: end === null ? start.line : end.line,
            endColumn: end === null ? start.column + 1 : end.column,
        }
    }

    /** The climb and the emit, which every ask needs and none of them needs differently. */
    private async prepared(
        path: string,
        text: string,
    ): Promise<{ tsconfig: string; emitted: EmitResult } | null> {
        if (this.gone) return null
        let tsconfig: string | null
        let emitted: EmitResult
        try {
            // The climb and the emit are independent, so they go together — the climb is memoised and
            // the emit is not, and on the first ask of a session neither should wait on the other.
            ;[tsconfig, emitted] = await Promise.all([
                configAbove(path.slice(0, path.lastIndexOf('/'))),
                emitModule(path, text),
            ])
        } catch {
            return null
        }
        return tsconfig === null ? null : { tsconfig, emitted }
    }

    /** Let the child go. Called when the session ends; a killed child takes its program with it. */
    close(): void {
        this.reading?.cancel().catch(() => {})
        this.child?.kill()
        this.child = null
        this.reading = null
    }

    /** One exchange, queued behind whatever is already in flight. `null` for a checker that is gone. */
    private ask(request: Asked): Promise<Answer | null> {
        const next = this.tail.then(() => this.exchange(request))
        // The TAIL is the swallowed one, never the answer: a rejected tail would skip every exchange
        // queued behind it, and a caller awaiting `next` still gets the throw.
        this.tail = next.catch(() => null)
        return next
    }

    private async exchange(request: Asked): Promise<Answer | null> {
        const child = this.start()
        if (child === null) return null
        try {
            child.stdin.write(`${JSON.stringify(request)}\n`)
            await child.stdin.flush()
            return JSON.parse(await this.line()) as Answer
        } catch (error) {
            // A child that died mid-answer has lost its program with it, so the session is over
            // rather than retried: respawning would rebuild the whole project on the next keystroke,
            // and a checker that fails once on a machine usually fails again for the same reason.
            this.say(`abide lsp: the checker stopped — ${error instanceof Error ? error.message : error}`)
            this.close()
            this.gone = true
            return null
        }
    }

    private start(): Bun.Subprocess<'pipe', 'pipe', 'pipe'> | null {
        if (this.child !== null) return this.child
        try {
            // NODE, not Bun, and spawned rather than imported: TypeScript 7's checker reads a Node
            // internal Bun does not expose. `internal/diagnosed.ts` carries the whole reason.
            const child = Bun.spawn(['node', new URL('internal/diagnosed.ts', import.meta.url).pathname], {
                cwd: process.cwd(),
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
            })
            this.child = child
            this.reading = child.stdout.getReader()
            return child
        } catch (error) {
            this.say(`abide lsp: no type checking — ${error instanceof Error ? error.message : error}`)
            this.gone = true
            return null
        }
    }

    private async line(): Promise<string> {
        const reader = this.reading
        if (reader === null) throw new Error('the checker was not started')
        for (;;) {
            const at = this.held.indexOf('\n')
            if (at !== -1) {
                const line = this.held.slice(0, at)
                this.held = this.held.slice(at + 1)
                return line
            }
            const { value, done } = await reader.read()
            if (done) throw new Error('the checker closed its output')
            this.held += DECODER.decode(value, STREAMING)
        }
    }

    private say(text: string): void {
        this.options.log?.(text)
    }
}

/** `/g`, so `lastIndex` is reset at every entry — this is shared and `exec` carries state. */
const IMPORT_STATEMENT = /import[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g

/** The specifier of the `import` statement `offset` sits in, side-effect form included. */
function importedAt(text: string, offset: number): string | null {
    IMPORT_STATEMENT.lastIndex = 0
    for (;;) {
        const match = IMPORT_STATEMENT.exec(text)
        if (match === null) return null
        if (match.index > offset) return null
        if (offset <= match.index + match[0].length) return (match[1] ?? match[2]) as string
    }
}

/**
 * A specifier as a path on disk, resolved from the importing file's own directory.
 *
 * `Bun.resolveSync` and nothing else, because it is the resolver that actually runs: a bare `abide`,
 * a `#tests/PATHS.ts` subpath import and a relative `../valid/props.abide` are three different
 * lookups and only the last is path arithmetic. It resolves a `.abide` like any other file — the
 * extension needs a loader to be IMPORTED, not to be found.
 *
 * `null` is what a specifier that resolves to nothing gets, and that is the answer rather than a gap:
 * it throws for a path that does not exist, so the alternative is sending an author to a file that
 * is not there.
 */
function resolveFrom(path: string, specifier: string): string | null {
    try {
        return Bun.resolveSync(specifier, path.slice(0, path.lastIndexOf('/')))
    } catch {
        return null
    }
}

/** A zero-based line and character as an offset into `text`. */
function offsetOf(text: string, line: number, character: number): number {
    let at = 0
    for (let i = 0; i < line; i++) {
        const next = text.indexOf('\n', at)
        if (next === -1) return text.length
        at = next + 1
    }
    return Math.min(at + character, text.length)
}

/**
 * The segments that map a generated module, read from the `.abide` it was emitted from.
 *
 * `null` for a path that is not in the mirror at all, which is the answer for an ordinary `.ts` — it
 * was never generated, so there is nothing to map. Also `null` for a source that has gone or no
 * longer compiles, because a stale mirror entry is exactly the case where a mapping would be
 * confidently wrong.
 */
async function segmentsForModule(file: string): Promise<Segment[] | null> {
    const source = sourceFor(file)
    if (source === null) return null
    try {
        return compile(await Bun.file(source).text(), { filename: source }).segments
    } catch {
        return null
    }
}

/**
 * Every diagnostic moved onto the `.abide` line, and the ones that cannot be dropped.
 *
 * Dropped rather than pinned somewhere: a position with no mapping is inside code the emitter WROTE
 * — a template's scaffolding, an import it added — and an author who never typed it cannot act on a
 * squiggle over the line that happens to be nearest. `abide check` keeps those and marks them
 * `[generated]`, which is the right answer for a list somebody reads and the wrong one for a mark on
 * a page.
 */
function placed(emitted: EmitResult, diagnostics: NonNullable<Answer['diagnostics']>): Placed[] {
    const out: Placed[] = []
    for (const diagnostic of diagnostics) {
        const start = placeIn(emitted.segments, diagnostic.line, diagnostic.character)
        if (start === null) continue
        const end = placeIn(emitted.segments, diagnostic.endLine, diagnostic.endCharacter)
        // A range that came back inverted — the end mapped to an earlier expression than the start —
        // is one hole's worth of text, so it is drawn from the start rather than backwards from it.
        const after =
            end === null || end.line < start.line || (end.line === start.line && end.column <= start.column)
                ? { line: start.line, column: start.column + 1 }
                : end
        out.push({
            line: start.line,
            column: start.column,
            endLine: after.line,
            endColumn: after.column,
            category: diagnostic.category,
            code: diagnostic.code,
            message: diagnostic.text,
        })
    }
    return out
}
