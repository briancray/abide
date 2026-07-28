// flagAbsent(argv, flag) — true unless the given boolean flag is present (e.g. `--no-install`). The
// opt-OUT spelling is the one that reads at the call site: `if (flagAbsent(rest, '--no-git')) git()`.
export function flagAbsent(argv: string[], flag: string): boolean {
    return !argv.includes(flag)
}
