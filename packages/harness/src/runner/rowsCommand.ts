// THE COMMAND LINE BOTH ROW RUNNERS SHARE. `--list` prints the catalog as one JSON array; anything
// else runs what `--scope` and `--filter` select and prints one row per line as each lands.
// Stdout is the channel, so a runner reports through `emit` and never through `console.log`.

import { inScope, matchesFilter, type RowItem } from '../rows/index.ts'

function flag(name: string): string {
    const at = process.argv.indexOf(name)
    return at === -1 ? '' : (process.argv[at + 1] ?? '')
}

/** Prints `items` as a catalog under `--list`, or runs the selected ones and streams their rows. */
export async function rowsCommand<Item extends RowItem, Row>(
    items: Item[],
    run: (selected: Item[], emit: (row: Row) => void) => Promise<void>,
): Promise<void> {
    if (process.argv.includes('--list')) {
        const catalog: RowItem[] = []
        for (const { id, section, name } of items)
            catalog.push({ id, section, name })
        process.stdout.write(`${JSON.stringify(catalog)}\n`)
        return
    }
    const scope = flag('--scope')
    const filter = flag('--filter')
    const selected: Item[] = []
    for (const item of items)
        if (inScope(item, scope) && matchesFilter(item, filter))
            selected.push(item)
    await run(selected, (row) => {
        process.stdout.write(`${JSON.stringify(row)}\n`)
    })
}
