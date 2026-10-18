// EVERY CHAPTER APP'S TESTS AND BENCHES, RUN AND KEPT: `bun run examples:results`. A card's Tests and
// Bench views read `examples/<app>/.abide/results.json`, so a page shows what the app's own files
// reported rather than a figure in its prose. Run serially: a bench shares the machine with nothing.

import { type Batched, claimOf, ratio } from '@abide/harness/report'
import type { TestRow } from '@abide/harness/rows'
import type { ExampleResults } from '../src/lib/ExampleResults.ts'

const EXAMPLES = new URL('../examples/', import.meta.url)

async function testsOf(app: string): Promise<Record<string, TestRow>> {
    const child = Bun.spawn({
        cmd: [
            process.execPath,
            Bun.fileURLToPath(new URL('exampleTests.ts', import.meta.url)),
            app,
            '--scope',
            'all',
        ],
        stdout: 'pipe',
        stderr: 'inherit',
    })
    const rows: Record<string, TestRow> = {}
    for (const line of (await new Response(child.stdout).text()).split('\n')) {
        if (line === '') continue
        const row = JSON.parse(line) as TestRow
        // The last row a file reports is where its run ended.
        rows[row.id] = row
    }
    if ((await child.exited) !== 0)
        throw new Error(`the tests of ${app} did not run`)
    return rows
}

async function benchesOf(app: string): Promise<ExampleResults['benches']> {
    const benches: ExampleResults['benches'] = {}
    const root = new URL(`${app}/`, EXAMPLES)
    for (const path of new Bun.Glob('src/**/*.bench.ts').scanSync({
        cwd: Bun.fileURLToPath(root),
    })) {
        const { priced } = (await import(new URL(path, root).href)) as {
            priced: () => Batched
        }
        const measured = priced()
        const arms: Record<string, number> = {}
        const names: string[] = []
        for (const [name, sample] of Object.entries(measured.samples))
            if (!name.endsWith('(A/A)')) {
                arms[name] = sample.nanoseconds
                names.push(name)
            }
        const first = measured.samples[names[0] ?? '']
        const last = measured.samples[names[names.length - 1] ?? '']
        benches[path] = {
            case: measured.case,
            n: measured.n,
            floor: measured.floor,
            arms,
            claim:
                first && last && first !== last
                    ? `${names[names.length - 1]} against ${names[0]}: ${claimOf(
                          ratio(last, first, { floor: measured.floor }),
                      )}`
                    : '',
        }
    }
    return benches
}

for (const entry of new Bun.Glob('*/package.json').scanSync({
    cwd: Bun.fileURLToPath(EXAMPLES),
})) {
    const app = entry.slice(0, entry.indexOf('/'))
    const results: ExampleResults = {
        ranAt: new Date().toISOString(),
        tests: await testsOf(app),
        benches: await benchesOf(app),
    }
    await Bun.write(
        new URL(`${app}/.abide/results.json`, EXAMPLES),
        `${JSON.stringify(results, null, 4)}\n`,
    )
    console.log(
        `${app}: ${Object.keys(results.tests).length} test files, ${Object.keys(results.benches).length} benches`,
    )
}
