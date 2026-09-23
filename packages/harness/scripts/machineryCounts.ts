// THE MACHINERY TRIPLE'S TWO COUNTABLE MEMBERS, for the harness package itself — code lines and
// exported names. The third, branches added to a shared path, stays hand-counted.
//
// ONE COUNT, TWO READERS. `bun run bench` prints it and `bun run status` serves it, and the two
// printed different numbers for as long as each globbed the tree itself: 44.1's five entries were
// spelled out in both files, so an entry added to one was a dashboard that disagreed with the
// bench beside it.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'
import { HARNESS_ENTRIES } from './HARNESS_ENTRIES.ts'

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
