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

import { BOLD, colored, DIM, paint } from './internal/paint.ts'

/** What a command does with the arguments after its own name. The number it answers is the exit code. */
export type CommandBody = (argv: string[]) => Promise<number>

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

/**
 * The usage screen, built from the table above and nothing else.
 *
 * Widths come off the rows rather than a constant, so adding a longer command name lines the column
 * up instead of breaking it — the one piece of formatting worth computing, because it is the one a
 * hand-written screen always gets wrong first.
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

    let width = 0
    for (const [left] of rows) if (left.length > width) width = left.length

    const lines = [bold('abide'), '', `${dim('usage:')} abide <command> [args…]`, '']
    for (const [left, right] of rows) lines.push(`  ${left.padEnd(width)}  ${dim(right)}`)
    return lines.join('\n')
}
