// flagValue(argv, flag) — the value of a `--flag <value>` / `--flag=<value>` option, or undefined when
// the flag is absent or trails nothing. A following flag is not a value (`--target --out x` yields
// undefined for `--target`), which is what lets an optional-value flag like `--platforms` mean "the
// default set".
//
// BOTH SPELLINGS, because half of this binary already accepted both and half did not. `parseGlobals`
// (`runCompiledApp.ts`) and `parseCliArgs` split on `=`, while this helper and `parsePort` used a bare
// `indexOf`, so `./app --url=https://x greet --n=5` worked in the same command line where
// `./app serve --port=9000` silently bound 3000. Nothing reported the unrecognized token, so every
// `=`-spelled flag simply fell back to its default — and the worst of those is
// `abide compile --target=bun-linux-x64`, which dropped the target, wrote a HOST-architecture binary,
// and printed the success banner naming the path you were about to ship.
export function flagValue(argv: string[], flag: string): string | undefined {
    const prefix = `${flag}=`
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index]
        if (token === undefined) continue
        if (token.startsWith(prefix)) {
            const inline = token.slice(prefix.length)
            // `--flag=` with nothing after it is a flag that trails nothing, same as a bare `--flag`.
            return inline.length > 0 ? inline : undefined
        }
        if (token === flag) {
            const raw = argv[index + 1]
            if (raw === undefined || raw.startsWith('-')) return undefined
            return raw
        }
    }
    return undefined
}

// Is the flag PRESENT, in either spelling? A separate question from whether it has a VALUE: `--platforms`
// alone means the default release set and `--platforms=a,b` names one, so a caller that tests presence
// with `argv.includes` reads the `=` form as absent.
export function flagPresent(argv: string[], flag: string): boolean {
    const prefix = `${flag}=`
    for (const token of argv) {
        if (token === flag || token.startsWith(prefix)) return true
    }
    return false
}
