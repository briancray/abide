// The CLI's whole surface, as data.
//
// One table, and the help is GENERATED from it — so a command that exists is a command that is
// documented, and a command that is documented is one you can run. The two drifting apart is the
// normal failure of a hand-written usage string, and it is not a failure this can have: `abide
// --help` prints these rows, and `abide <name>` dispatches on these names.
//
// What is NOT here does not exist. A row for a command that answers "not implemented" would be a
// help screen advertising something, so an unwritten command is one this binary does not know:
// `abide deploy` exits `2` like any other word it was not given.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { aligned, BOLD, colored, DIM, paint } from './internal/paint.ts'

/** What a command does with the arguments after its own name. The number it answers is the exit code. */
type CommandBody = (argv: string[]) => Promise<number>

export interface Command {
    name: string
    /** How the arguments are spelled, for the usage line. Empty when it takes none. */
    args: string
    /** One line. The usage screen is these, aligned. */
    blurb: string
    /**
     * The body, reached LAZILY.
     *
     * `abide --help` is the most common thing this binary is asked to do and it is the one that
     * should cost nothing: a static import here would load the compiler and the tail client to print
     * three lines of text. It is also what keeps the dispatch honest — the table is the only place a
     * name is written, so there is no `switch` to fall out of step with the screen.
     */
    load: () => Promise<CommandBody>
}

/** Ordered as somebody meets them: poke at it, run something, check it, work on it, ship it, watch it. */
export const COMMANDS: Command[] = [
    {
        name: 'repl',
        args: '',
        blurb: 'An abide prompt: the isomorphic surface in scope, and `.abide` files importable.',
        load: async () => (await import('./internal/repl.ts')).repl,
    },
    {
        name: 'run',
        args: '<file> [args…]',
        blurb: 'Run a script under the abide runtime. Everything after <file> belongs to the script.',
        load: async () => (await import('./internal/run.ts')).run,
    },
    {
        name: 'check',
        args: '[dir…]',
        blurb: 'Type-check `.abide` script bodies, reporting on the `.abide` line.',
        load: async () => (await import('./internal/check.ts')).check,
    },
    {
        name: 'dev',
        args: '[--port <n>]',
        blurb: 'Serve the app and restart it on every change. --port HOPS to the next free one if taken.',
        load: async () => (await import('./internal/dev.ts')).dev,
    },
    {
        name: 'build',
        args: '[entry…]',
        blurb: 'Bundle the client into .abide/client: split, hashed, minified, precompressed.',
        load: async () => (await import('./internal/build.ts')).build,
    },
    {
        name: 'start',
        args: '[--port <n>]',
        blurb: 'Serve the app against what `abide build` wrote. --port binds, and fails if it is taken.',
        load: async () => (await import('./internal/start.ts')).start,
    },
    {
        name: 'console',
        args: '[<action|endpoint> [--arg=…]]',
        blurb: "The app's own console: its endpoints by name, plus connect/serve/health/logs. A prompt with none.",
        load: async () => (await import('./internal/console.ts')).runConsole,
    },
    {
        name: 'compile',
        args: '[--out <path>] [--target <t>]',
        blurb: 'ONE standalone executable — the app, its bundle and its console, via `bun build --compile`.',
        load: async () => (await import('./internal/compile.ts')).compile,
    },
    {
        name: 'logs',
        args: '',
        blurb: "Tail a running app's log feed. ABIDE_APP_URL names it; ABIDE_APP_TOKEN is its bearer.",
        load: async () => (await import('./internal/logs.ts')).logs,
    },
]

export function commandNamed(name: string): Command | undefined {
    for (const command of COMMANDS) if (command.name === name) return command
    return undefined
}

/** One command's own line: how it is spelled, and what it does. What `abide <name> --help` prints. */
export function usageOf(command: Command): string {
    const on = colored()
    const spelled = command.args === '' ? command.name : `${command.name} ${command.args}`
    return `${paint('usage:', DIM, on)} abide ${spelled}\n  ${paint(command.blurb, DIM, on)}`
}

/**
 * A refusal, printed — and the exit code that goes with it.
 *
 * The usage line comes off the command's own ROW rather than being retyped beside the code that
 * refused. Every command had its own copy of these two lines, so `args` was written twice per command
 * — once for the help screen and once for the refusal — and the two are one fact.
 */
export function refuse(name: string, problem: string): number {
    console.error(`abide ${name}: ${problem}`)
    const args = commandNamed(name)?.args ?? ''
    console.error(`       usage: abide ${name}${args === '' ? '' : ` ${args}`}`)
    return CLI_EXIT_CODES.usage
}

/**
 * The roots a `[dir…]`-shaped command was handed, or the code to exit with.
 *
 * Shared by `check` and `build` because they have the same argument shape and disagreed about it: a
 * flag was REFUSED by one and silently DROPPED by the other, and the one that dropped it is the one
 * whose `args` says `[dir…]`. `abide check --lint` ran a full check of the working directory and said
 * nothing — which is `build`'s own comment about `--minify`, arrived at from the other side.
 *
 * Refused rather than ignored: the command IS the check, or the build, so there is nothing here for a
 * flag to turn on, and one somebody typed did not do what they asked.
 */
export function pathsOnly(name: string, argv: string[]): string[] | number {
    for (const argument of argv) {
        if (argument.startsWith('-')) return refuse(name, `unknown option \`${argument}\``)
    }
    return argv
}

/** `null` when a command that takes nothing was given nothing, else the code to exit with. */
export function takesNothing(name: string, argv: string[]): number | null {
    return argv.length > 0 ? refuse(name, `takes no arguments, got ${argv[0]}`) : null
}

/**
 * The usage screen, built from the table above and nothing else.
 */
export function usage(): string {
    const on = colored()
    const bold = (text: string) => paint(text, BOLD, on)
    const dim = (text: string) => paint(text, DIM, on)

    const rows: [string, string][] = []
    for (const command of COMMANDS) {
        rows.push([command.args === '' ? command.name : `${command.name} ${command.args}`, command.blurb])
    }
    rows.push(['-h, --help', 'This.'])

    const lines = [bold('abide'), '', `${dim('usage:')} abide <command> [args…]`, '']
    for (const line of aligned(rows, on)) lines.push(line)
    return lines.join('\n')
}
