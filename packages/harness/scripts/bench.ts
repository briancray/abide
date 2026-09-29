// `bun run bench` — the machinery triple's two countable members for the harness package itself,
// printed: code lines and exported names. The third, branches added to a shared path, stays
// hand-counted. Every other bench is a script of its own under `bench:*`, and the ones with a
// hand-written arm are rows on the docs app's `/bench` page too.
//
// A WORKSPACE SCRIPT AND NOT AN `abide` COMMAND. `abide <cmd>` is governed surface —
// RULEBOOK 38 and REGISTRY's Commands section — so a bench subcommand would owe a
// clause, a registry row and a decisions entry, for a tool no app author runs.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'

/**
 * The harness package's public entries, in the order the lanes are read in.
 *
 * 44.1 — FIVE ENTRIES, THREE LANES. The package's whole public surface: `measure` counts DOM calls
 * from inside the page, `engine` is what Blink did, `server` is bytes and turns on bun, and the two
 * that are not lanes are `report` (the Sample, the clock, the batcher, `ratio()`) and `gate` (the
 * bun-side test vocabulary).
 */
const HARNESS_ENTRIES: readonly string[] = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]

async function machinery(): Promise<void> {
    const source = new URL('../src/', import.meta.url)
    const files = [
        ...new Bun.Glob('**/*.ts').scanSync({
            cwd: source.pathname,
            onlyFiles: true,
        }),
    ]
    const lines = await countLines(source, files)
    const names = await countExportedNames(HARNESS_ENTRIES)
    console.log(`harness: ${lines} code lines across ${files.length} files`)
    console.log(`harness: ${names.total} exported names`)
    for (const [entry, exported] of Object.entries(names.byEntry))
        console.log(`  ${entry}: ${exported.join(', ') || '—'}`)
}

if (import.meta.main) await machinery()
