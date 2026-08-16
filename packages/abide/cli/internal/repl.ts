// `abide repl` — a prompt with the isomorphic surface already in scope.
//
// Three decisions carry this file.
//
// **`node:vm`, not `eval`.** A REPL's whole contract is that what you declared on one line is there
// on the next, and `(0, eval)('const x = 1')` does not keep `x` in JavaScriptCore — a global lexical
// binding made by `eval` does not survive the call. `vm.runInThisContext` does keep it, and it hands
// back the completion value, which is what makes a bare expression print its result with nothing
// parsing statements to find one.
//
// **`Bun.Transpiler`, not a parser of our own.** It answers the two questions a prompt actually has
// — is this TypeScript I can run, and is this line FINISHED — and it answers the second in the error
// message, so multi-line input is one string compare rather than a bracket counter that disagrees
// with the language about templates and comments. The `.abide` compiler is not the right tool here:
// a REPL line is TypeScript, not a component.
//
// **Top-level `await` is the FALLBACK, not the shape.** The common line has none, and running it
// plainly is what keeps `const` persistent. A line that does have one fails to COMPILE — nothing has
// run yet — so the retry through an async wrapper is exact rather than a guess, and it is reached by
// the engine's own answer instead of by a regex deciding what "top level" means.

// `node:vm` for the persistent context: Bun has no api that evaluates in a reusable global scope.
import vm from 'node:vm'
// The runtime, which is the whole of what makes this an ABIDE prompt rather than a JavaScript one:
// `await import('./page.abide')` compiles on the way in, exactly as it does under `run`. Through the
// module that OWNS the registration rather than by calling `plugin(abidePlugin)` again — this file is
// reached lazily through its row in `COMMANDS`, so the side effect costs `abide --help` nothing.
import '$compiler/preload.ts'
import * as SURFACE from '$abide'
import { isSource } from '$shared/internal/BRANDS.ts'
import { internals } from '$shared/internal/graph.ts'
import { isThenable, messageOf } from '$shared/internal/probes.ts'
import { STREAMING } from '$shared/internal/STREAMING.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { takesNothing } from '../COMMANDS.ts'
import { LineEditor, suggest } from './editor.ts'
import { BOLD, colored, DIM, paint, RED } from './paint.ts'

/** Both are the same width, so a continued line sits under the one that started it. */
const PROMPT = 'abide> '
const CONTINUE = '   ... '

/** A word the transpiler will not have to be asked about, for the ghost. */
const KEYWORDS = [
    'await',
    'async',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'delete',
    'else',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'instanceof',
    'let',
    'new',
    'null',
    'return',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'yield',
]

/** What the transpiler says when the input simply has not finished yet. */
const UNFINISHED = /end of file|Unterminated/

const AWAIT = /\bawait\b/

/** A leading `const x =`, the one declaration shape that can be kept when a line has to be wrapped. */
const LEADING = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/

/** Names a session declared, for the ghost — a `const` lives in the global LEXICAL scope, which is not a property of anything. */
const DECLARES = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g

type Prepared = { kind: 'more' } | { kind: 'bad'; message: string } | { kind: 'run'; code: string }

/**
 * How a line is run, and the one option that is not cosmetic.
 *
 * A script inside `vm` has no dynamic import of its own, so `await import('./page.abide')` — the
 * whole reason this prompt registers the loader — needs the callback. Specifiers are resolved
 * against the WORKING DIRECTORY rather than against this file: `./page.abide` at a prompt means the
 * one in the project you opened the prompt in, not one beside the CLI. A specifier that resolves to
 * nothing is handed over untouched, so the import itself is what reports it.
 */
const RUNNING = {
    filename: 'repl',
    importModuleDynamically: (specifier: string) => {
        let resolved = specifier
        try {
            resolved = Bun.resolveSync(specifier, process.cwd())
        } catch {
            // Not resolvable from here — a node: builtin, or a typo. Both are the import's to answer.
        }
        return import(resolved)
    },
} as unknown as vm.RunningScriptOptions

/**
 * One prompt's worth of state: what has been typed but not finished, and what it has declared.
 *
 * A class rather than closures because both lanes below drive the same one — a terminal feeds it a
 * line at a time and a pipe feeds it a file — and there is exactly one place that decides what a line
 * MEANS.
 */
class Session {
    /** True while a line is unfinished, which is the only thing the prompt shape depends on. */
    continuing = false
    /** Whether anything thrown got as far as being reported. A piped session ends on this. */
    threw = false

    private held = ''
    // Dead-code elimination OFF, and this is the one option that matters here: a prompt's input is
    // precisely the code whose only purpose is its VALUE, so `({ a: 1 })` on its own is dropped as
    // pointless by a transpiler that is right about a build and wrong about a REPL — and dropped
    // silently, which reads as a line that printed nothing.
    private readonly transpiler = new Bun.Transpiler({ loader: 'ts', deadCodeElimination: false })
    private readonly declared = new Set<string>()
    // The candidate list, held until a line runs. Rebuilding it is ~200 `getOwnPropertyNames` entries
    // and an array, and the ghost asks for it on every KEYSTROKE — but a global can only arrive, and
    // `declared` can only grow, when `take()` evaluates something.
    private candidates: string[] | null = null

    constructor(private readonly colors: boolean) {}

    /** Every name a completion may offer. Rebuilt after a line runs: a global may have arrived on it. */
    names(): string[] {
        if (this.candidates !== null) return this.candidates
        const found = new Set<string>(KEYWORDS)
        for (const key of Object.getOwnPropertyNames(globalThis)) found.add(key)
        for (const key of this.declared) found.add(key)
        this.candidates = [...found]
        return this.candidates
    }

    /** Abandon whatever is half-typed. What Ctrl-C means, and the only way out of an unfinished line. */
    abandon(): void {
        this.held = ''
        this.continuing = false
    }

    async take(line: string): Promise<void> {
        // A blank line is nothing to run — but a blank line INSIDE an unfinished one is part of it.
        // Ctrl-C is the way out of a line you no longer want, rather than an empty one: a paste with
        // a blank line in the middle of a function body is the common case, and abandoning the block
        // there would be a prompt refusing the most ordinary thing anyone pastes into it.
        if (!this.continuing && line.trim() === '') return

        const source = this.held === '' ? line : `${this.held}\n${line}`
        const prepared = this.prepare(source)
        if (prepared.kind === 'more') {
            this.held = source
            this.continuing = true
            return
        }
        this.abandon()
        if (prepared.kind === 'bad') {
            this.report(prepared.message)
            return
        }

        for (const found of source.matchAll(DECLARES)) this.declared.add(found[1] as string)
        // This line is about to declare things and to run code that may put a global up. Nothing asks
        // for the list again until the next keystroke, so dropping it here is the whole invalidation.
        this.candidates = null

        let value: unknown
        try {
            value = vm.runInThisContext(prepared.code, RUNNING)
        } catch (failure) {
            // A `SyntaxError` from a line holding `await` is top-level await and nothing else: the
            // failure is at COMPILE time, so nothing ran and the retry cannot repeat a side effect.
            if (!(failure instanceof SyntaxError) || !AWAIT.test(prepared.code)) {
                this.reportFailure(failure)
                return
            }
            const wrapped = this.wrap(source)
            if (wrapped === null) {
                this.reportFailure(failure)
                return
            }
            try {
                value = vm.runInThisContext(wrapped, RUNNING)
            } catch (again) {
                this.reportFailure(again)
                return
            }
        }

        try {
            // A SOURCE is asked first, because a cell is THENABLE — `await x` is how you wait for one
            // to settle — so awaiting the result of a line would hand back the value inside the cell
            // and print that instead. `c` at a prompt means the cell.
            //
            // Otherwise: guarded, not awaited. A value that is already settled should not cost a tick
            // to learn that.
            const settled = isSource(value) || !isThenable(value) ? value : await value
            if (settled !== undefined) process.stdout.write(`${show(settled, this.colors)}\n`)
        } catch (failure) {
            this.reportFailure(failure)
        }
    }

    /** What to run, or what to say instead. */
    private prepare(source: string): Prepared {
        let js: string
        try {
            js = this.transpiler.transformSync(source)
        } catch (failure) {
            const message = messageOf(failure)
            return UNFINISHED.test(message) ? { kind: 'more' } : { kind: 'bad', message }
        }

        // Asked of the SOURCE and structurally: the transpiler already knows an import statement from
        // a dynamic one, so nothing here has to track how an emitted import is spelled or mistake the
        // word `import` at the start of a line inside a template for one.
        for (const found of this.transpiler.scanImports(source)) {
            if (found.kind !== 'import-statement') continue
            return {
                kind: 'bad',
                message: "a repl line is not a module — `await import('…')` is how one arrives here",
            }
        }

        // An object literal is a BLOCK in statement position, so the one thing that has to be
        // disambiguated is the one shape that says so for itself: braces at both ends.
        if (/^\s*\{/.test(source) && /\}\s*$/.test(source)) {
            const asValue = this.transform(`(\n${source}\n)`)
            if (asValue !== null) return { kind: 'run', code: asValue }
        }
        return { kind: 'run', code: js }
    }

    /**
     * The same source inside an async function, for a line that turned out to hold a top-level await.
     *
     * A declaration would be scoped to the wrapper and lost, so a leading `const x =` becomes a
     * global — which is the shape a prompt writes ninety per cent of the time. Anything more
     * elaborate (a destructure, a class) runs and does not persist, and that is a real limit rather
     * than one worth a parser: the line that wanted it can be typed as two.
     */
    private wrap(source: string): string | null {
        if (!/^\s*(?:export|import|function|class|const|let|var|async\s+function)\b/.test(source)) {
            const asValue = this.transform(`(async () => (\n${source}\n))()`)
            if (asValue !== null) return asValue
        }
        return this.transform(`(async () => {\n${source.replace(LEADING, 'globalThis.$1 =')}\n})()`)
    }

    private transform(source: string): string | null {
        try {
            return this.transpiler.transformSync(source)
        } catch {
            return null
        }
    }

    private reportFailure(failure: unknown): void {
        if (failure instanceof Error) {
            this.report(`${failure.name}: ${failure.message}`)
            return
        }
        this.report(Bun.inspect(failure))
    }

    /** stderr, so a piped session's results stay separable from what went wrong producing them. */
    private report(message: string): void {
        this.threw = true
        process.stderr.write(`${paint(message, RED, this.colors)}\n`)
    }
}

export async function repl(argv: string[]): Promise<number> {
    const refusal = takesNothing('repl', argv)
    if (refusal !== null) return refusal

    Object.assign(globalThis, SURFACE, { abide: SURFACE })

    const colors = colored()
    const session = new Session(colors)
    const interactive = process.stdin.isTTY === true
    if (!interactive) return await piped(session)
    return await prompted(session, colors)
}

/**
 * A pipe, a heredoc, a file. No banner, no editor, no raw mode — the same evaluation and the same
 * printing, so what a script gets out of this is what a terminal would have shown.
 *
 * The exit code is the one difference: a session that was HANDED its input has no one watching the
 * errors go past, so one that threw ends `1`.
 */
async function piped(session: Session): Promise<number> {
    const text = await Bun.stdin.text()
    for (const line of text.split('\n')) await session.take(line)
    if (session.continuing) {
        process.stderr.write('abide repl: the input ended in the middle of a line\n')
        return CLI_EXIT_CODES.failed
    }
    return session.threw ? CLI_EXIT_CODES.failed : CLI_EXIT_CODES.ok
}

async function prompted(session: Session, colors: boolean): Promise<number> {
    process.stdout.write(banner(colors))

    let leaving = false
    const lines: string[] = []
    const editor = new LineEditor(
        {
            write: (text) => void process.stdout.write(text),
            // Asked per KEYSTROKE, which is why `names()` holds its list: the ghost is on the repaint
            // path, and the answer can only change when a line has run.
            complete: (prefix) => suggest(prefix, session.names()),
            onLine: (line) => void lines.push(line),
            onInterrupt: () => session.abandon(),
            onEnd: () => {
                leaving = true
            },
        },
        colors,
    )
    editor.prompt = PROMPT
    editor.refresh()

    process.stdin.setRawMode(true)
    const decoder = new TextDecoder()
    try {
        for await (const chunk of process.stdin) {
            editor.feed(decoder.decode(chunk as Uint8Array, STREAMING))
            // Reading is OUR loop, so nothing is read while a line is being evaluated and a keystroke
            // typed during a slow one waits in the terminal's own buffer rather than in ours.
            const ran = lines.length > 0
            while (lines.length > 0) await session.take(lines.shift() as string)
            if (leaving) break
            // Only after a line: `feed` already repainted for the keystroke, and what a run leaves
            // behind is a printed result the prompt has to be put back under.
            if (!ran) continue
            editor.prompt = session.continuing ? CONTINUE : PROMPT
            editor.refresh()
        }
    } finally {
        process.stdin.setRawMode(false)
        process.stdout.write('\n')
    }
    return CLI_EXIT_CODES.ok
}

function banner(colors: boolean): string {
    const title = paint('abide repl', BOLD, colors)
    const said = paint(
        `bun ${Bun.version} · state · memo · channel · watch and the rest of \`abide\` are in scope · ctrl-d to leave`,
        DIM,
        colors,
    )
    return `${title}\n${said}\n`
}

/**
 * A source as this file prints one.
 *
 * The four probes are on every primitive — a `state`, a `memo` and a `channel` all answer them, which
 * is what lets a reader treat any source alike. `publish` and `refresh` are the two that are NOT, and
 * that is the whole of how the kind is told.
 */
interface Source {
    peek(): unknown
    pending(): boolean
    settled(): boolean
    error(): unknown
    publish?: unknown
    refresh?: unknown
}

/**
 * What a value looks like when it is printed back.
 *
 * A SOURCE gets its own line rather than `[Function: state]`, which is what `Bun.inspect` has to say
 * about a callable and is the least useful true thing in this framework. It is read through `peek`
 * for the reason `peek` exists: printing a result must not subscribe anything or start a load, so a
 * prompt showing a cell cannot be what made it fetch.
 */
function show(value: unknown, colors: boolean): string {
    if (!isSource(value)) return Bun.inspect(value, { colors })

    const source = value as unknown as Source
    const kind =
        typeof source.publish === 'function'
            ? 'channel'
            : typeof source.refresh === 'function'
              ? 'memo'
              : 'state'
    // QUIETLY, all three: a probe kicks the load, and PRINTING a source must not run its body —
    // inspecting a cold memo at the prompt would warm it, and the next line would print a different
    // thing for having looked.
    const failed = internals.quietly(() => source.error())
    if (failed !== undefined) {
        const said = failed instanceof Error ? `${failed.name}: ${failed.message}` : Bun.inspect(failed)
        return paint(`${kind} ✗ ${said}`, RED, colors)
    }
    if (internals.quietly(() => source.pending())) return paint(`${kind} (pending)`, DIM, colors)
    // A source that has not settled holds NOTHING, and `undefined` is a value it could legitimately be
    // holding — so the two are said differently.
    if (!internals.quietly(() => source.settled())) {
        return paint(`${kind} ${kind === 'channel' ? '(nothing yet)' : '(cold)'}`, DIM, colors)
    }
    return `${paint(kind, DIM, colors)} ${Bun.inspect(source.peek(), { colors })}`
}
