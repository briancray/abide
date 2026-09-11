// THE BENCH PRODUCER. `bun run bench <example>` writes the rows it can produce back
// into `example.json` and says, per row, what produced them.
//
// A WORKSPACE SCRIPT AND NOT AN `abide` COMMAND. `abide <cmd>` is governed surface —
// RULEBOOK 38 and REGISTRY's Commands section — so a bench subcommand would owe a
// clause, a registry row and a decisions entry, for a tool no app author runs.
// See docs/DECISIONS.md D110.
//
// THE NOTE GOES PER ROW, and this is the question stage 5 of the plan manufactured
// rather than inherited. See docs/DECISIONS.md D112.
//
// WHAT THIS TABLE IS NOW: the rows a BROWSER CANNOT TAKE. Everything a page can
// measure about itself — nodes moved, nodes created, first paint, time per op — is
// measured live in the reader's own browser when they open the panel, so a static
// copy of it here would be a second, staler answer to a question already answered.
// What is left is what no page can see: a count over the SOURCE. See D118.
//
// A row is written only where BOTH arms produced a number, and no abide arm RUNS —
// `compiled/` is one emitted module, not a served page — so a row this cannot
// produce is DROPPED rather than left standing with hand-typed figures in it. An
// authored number in a results table reads as a result.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'

const EXAMPLES = new URL('../../dogfood/examples/', import.meta.url)

type BenchRow = {
    metric: string
    abide: string
    vanilla: string
    ratio: string
    note?: string
}

type Manifest = {
    files?: string[]
    vanilla?: string[]
    bench?: { note: string; shared?: string[]; rows: BenchRow[] }
}

const HARNESS_ENTRIES = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]

function today(): string {
    return new Date().toISOString().slice(0, 10)
}

function provenance(how: string): string {
    return `measured: ${how}, bun ${Bun.version} on ${process.platform} ${process.arch}, ${today()}`
}

// Lower is better for every metric a bench carries — milliseconds, nodes, bytes,
// lines — so the direction is read off the number rather than declared per row.
function ratioOf(abide: number, vanilla: number): string {
    return `${(abide / vanilla).toFixed(2)}x`
}

async function linesOfCode(
    name: string,
    manifest: Manifest,
): Promise<{ abide: number; vanilla: number } | null> {
    const abideFiles = manifest.files ?? []
    const vanillaFiles = manifest.vanilla ?? []
    if (abideFiles.length === 0 || vanillaFiles.length === 0) return null
    // A file BOTH arms use is not part of either arm's count. `read-invoice`'s
    // `database.ts` is the fixture the abide arm reaches through `#server/database`
    // and does not ship in `files/`, so counting it against the hand arm alone
    // charges one arm for something neither wrote.
    const shared = new Set(manifest.bench?.shared ?? [])
    const directory = new URL(`${name}/`, EXAMPLES)
    return {
        abide: await countLines(
            new URL('files/', directory),
            abideFiles.filter((file) => !shared.has(file)),
        ),
        vanilla: await countLines(
            new URL('vanilla/', directory),
            vanillaFiles.filter((file) => !shared.has(file)),
        ),
    }
}

export async function bench(name: string): Promise<void> {
    const path = new URL(`${name}/example.json`, EXAMPLES)
    const manifest = (await Bun.file(path).json()) as Manifest
    if (!manifest.bench) {
        console.log(`${name}: no bench to produce`)
        return
    }

    const lines = await linesOfCode(name, manifest)
    const rows: BenchRow[] = []
    if (lines)
        rows.push({
            metric: 'Lines of code',
            abide: String(lines.abide),
            vanilla: String(lines.vanilla),
            ratio: ratioOf(lines.abide, lines.vanilla),
            note: provenance('static line count, code lines only'),
        })

    const dropped = manifest.bench.rows
        .map((row) => row.metric)
        .filter((metric) => !rows.some((kept) => kept.metric === metric))
    manifest.bench.rows = rows
    manifest.bench.note =
        'Counted over the source, which is the half a browser cannot see. Everything else on this card is measured in your own browser, below.'
    await Bun.write(path, `${JSON.stringify(manifest, null, 4)}\n`)

    console.log(`${name}: produced ${rows.length} row(s)`)
    for (const row of rows)
        console.log(`  ${row.metric} ${row.abide}/${row.vanilla} ${row.ratio}`)
    if (dropped.length > 0)
        console.log(
            `  dropped — measured live in the browser, or no abide arm produced one: ${dropped.join(', ')}`,
        )
}

// The machinery triple's two countable members, for the package itself. The third —
// branches added to a shared path — stays hand-counted.
export async function machinery(): Promise<void> {
    const source = new URL('../src/', import.meta.url)
    const files: string[] = []
    for (const file of new Bun.Glob('**/*.ts').scanSync({
        cwd: source.pathname,
        onlyFiles: true,
    }))
        files.push(file)
    const lines = await countLines(source, files)
    const names = await countExportedNames(HARNESS_ENTRIES)
    console.log(`harness: ${lines} code lines across ${files.length} files`)
    console.log(`harness: ${names.total} exported names`)
    for (const [entry, exported] of Object.entries(names.byEntry))
        console.log(`  ${entry}: ${exported.join(', ') || '—'}`)
}

if (import.meta.main) {
    const [name] = process.argv.slice(2)
    if (name) await bench(name)
    else
        console.log(
            'bun run bench <example> — writes the rows it can produce into that example.json',
        )
    await machinery()
}
