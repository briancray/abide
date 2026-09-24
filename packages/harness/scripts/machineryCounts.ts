// THE MACHINERY TRIPLE'S TWO COUNTABLE MEMBERS, for the harness package itself — code lines and
// exported names. The third, branches added to a shared path, stays hand-counted.
//
// ONE COUNT, TWO READERS: `bun run bench` prints it and `bun run status` serves it, so neither
// globs the tree itself.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'

// 44.1 — FIVE ENTRIES, THREE LANES. The package's whole public surface, in the order the lanes are
// read in: `measure` counts DOM calls from inside the page, `engine` is what Blink did, `server` is
// bytes and turns on bun, and the two that are not lanes are `report` (the Sample, the clock, the
// batcher, `ratio()`) and `gate` (the bun-side test vocabulary).
const HARNESS_ENTRIES: readonly string[] = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]

export async function machineryCounts(): Promise<{
    lines: number
    files: number
    names: Awaited<ReturnType<typeof countExportedNames>>
}> {
    const source = new URL('../src/', import.meta.url)
    const files = [
        ...new Bun.Glob('**/*.ts').scanSync({
            cwd: source.pathname,
            onlyFiles: true,
        }),
    ]
    return {
        lines: await countLines(source, files),
        files: files.length,
        names: await countExportedNames(HARNESS_ENTRIES),
    }
}
