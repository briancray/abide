// Which shape a server log line takes. Read at call time (never cached) so a process that flips
// `ABIDE_LOG_FORMAT` mid-run — and the test suite — sees the change.
//
//   `pretty` — colour + columns, for a human at a terminal. THE DEFAULT WHEN STDOUT IS A TTY.
//   `tsv`    — the tab-separated line, for a pipe, a file, or a collector that splits on \t.
//   `json`   — one JSON record per line.
//
// A TTY is the signal, not an env var, because it is the only one that is true exactly when a person
// is reading: `abide dev` in a terminal gets columns, the same command under systemd/Docker/`| tee`
// gets a parseable line with no flag to remember. So `ABIDE_LOG_FORMAT` names only the two MACHINE
// formats — `tsv` and `json` — and is read as "this output is being consumed, not read". Forcing the
// human format the other way (colour into a pipe) is `FORCE_COLOR`, and refusing it on a terminal is
// `NO_COLOR`: both are the conventional spellings, so there is no third abide-specific name to learn.
// `NO_COLOR` lands on `tsv` rather than an uncoloured pretty line — colour IS what makes the columns
// scannable, and stripping it leaves padding that is strictly worse than the tab.

import { readEnv } from './readEnv.ts'

function isSet(name: string): boolean {
    const value = readEnv(name)
    return value !== undefined && value.length > 0
}

export function logFormat(): 'json' | 'tsv' | 'pretty' {
    const explicit = readEnv('ABIDE_LOG_FORMAT')
    if (explicit === 'json') return 'json'
    if (explicit === 'tsv') return 'tsv'

    if (isSet('NO_COLOR')) return 'tsv'
    if (isSet('FORCE_COLOR')) return 'pretty'

    const stdout = (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout
    return stdout?.isTTY === true ? 'pretty' : 'tsv'
}
