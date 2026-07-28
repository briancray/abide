// flagValue(argv, flag) — the value of a `--flag <value>` option, or undefined when the flag is absent
// or trails nothing. A following flag is not a value (`--target --out x` yields undefined for
// `--target`), which is what lets an optional-value flag like `--platforms` mean "the default set".
export function flagValue(argv: string[], flag: string): string | undefined {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const raw = argv[index + 1]
    if (raw === undefined || raw.startsWith('-')) return undefined
    return raw
}
