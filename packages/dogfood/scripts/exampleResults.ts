// EVERY CHAPTER APP'S TESTS AND BENCHES, RUN AND KEPT: `bun run examples:results`. A card's Tests and
// Bench views read `examples/<app>/.abide/results.json`, so a page shows what the app's own files
// reported rather than a figure in its prose. Run serially: a bench shares the machine with nothing.

import type { TestRow } from '@abide/harness/rows'
import { runBenches } from '@abide/harness/runner'
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
    for (const { file, name, over, ...figures } of await runBenches(
        Bun.fileURLToPath(new URL(`${app}/`, EXAMPLES)),
    )) {
        if (over.length > 0)
            throw new Error(`${app} ${file} ${name}: ${over.join('; ')}`)
        // A card shows one bench a file, so a second would overwrite the first unseen.
        if (benches[file] !== undefined)
            throw new Error(
                `${app} ${file} exports a second bench, ${name}, and a card shows one`,
            )
        benches[file] = figures
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
