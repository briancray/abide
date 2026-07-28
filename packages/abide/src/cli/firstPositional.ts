// firstPositional(argv) — the first positional (non-flag) argument, skipping the value a
// value-taking flag consumes. Used by `scaffold` to read the project <name> even when it follows
// `--port <n>`.
//
// The skip list is NAMED (VALUE_FLAGS) rather than assumed: it used to hardcode `--port` alone, so the
// day a second value-taking flag was accepted before a positional, `abide scaffold --out dist myapp`
// would silently scaffold a project called `dist`. A flag that takes a value belongs here.
const VALUE_FLAGS = new Set(['--port', '--target', '--out', '--platforms'])

export function firstPositional(argv: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) continue
        if (VALUE_FLAGS.has(arg)) {
            i++ // skip the flag's value
            continue
        }
        if (!arg.startsWith('-')) return arg
    }
    return undefined
}
