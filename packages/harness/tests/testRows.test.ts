// 43.26, 43.27 — THE TEST RUNNER AS A COMMAND, run as an app's runner script runs it: `--list` is the
// catalog as one JSON array, and a run prints one JSON row per line for what `--scope` and `--filter`
// select, each file in a process of its own and a file whose runner wrote no report `broken`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no temporary directory api
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '../src/gate/spawned.ts'

const RUNNER = new URL('../src/runner/testRows.ts', import.meta.url).pathname
let dir = ''

beforeAll(() => {
    dir = mkdtempSync(`${tmpdir()}/test-rows-`)
    mkdirSync(`${dir}/suite`)
    writeFileSync(
        `${dir}/suite/passes.test.ts`,
        "import { expect, test } from 'bun:test'\ntest('one', () => expect(1).toBe(1))\n",
    )
    // Gone before the runner can write its report.
    writeFileSync(`${dir}/suite/vanishes.test.ts`, 'process.exit(0)\n')
    writeFileSync(
        `${dir}/runner.ts`,
        `import { testRows } from '${RUNNER}'\nawait testRows([{ section: 'unit', root: 'suite', runner: 'bun' }], import.meta.dir)\n`,
    )
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const runner = (...args: string[]) =>
    spawned(['bun', 'runner.ts', ...args], { cwd: dir, deadline: 60_000 })

// The last row each file printed, by id.
function lastRows(
    stdout: string,
): Record<string, { state: string; tests: number }> {
    const rows: Record<string, { state: string; tests: number }> = {}
    for (const line of stdout.trim().split('\n')) {
        const row = JSON.parse(line) as {
            id: string
            state: string
            tests: number
        }
        rows[row.id] = row
    }
    return rows
}

// THE REVERT: write the catalog a row per line, as a run's rows are; the stdout is two lines and
// not one JSON array.
test('--list prints the catalog as one JSON array — 43.26', async () => {
    const listed = await runner('--list')
    expect(JSON.parse(listed.stdout)).toEqual([
        { id: 'suite/passes.test.ts', section: 'unit', name: 'passes.test.ts' },
        {
            id: 'suite/vanishes.test.ts',
            section: 'unit',
            name: 'vanishes.test.ts',
        },
    ])
}, 60_000)

// THE REVERTS: read a missing report as an empty result in `runOne`; `vanishes` reads `done` with 0
// tests. Run every file selected whatever `--filter` says; `vanishes` is printed too.
test('a run prints a row per line, a file with no report broken, for what is selected — 43.26, 43.27', async () => {
    const all = lastRows((await runner('--scope', 'all')).stdout)
    expect(all['suite/passes.test.ts']).toMatchObject({
        state: 'done',
        tests: 1,
    })
    expect(all['suite/vanishes.test.ts']?.state).toBe('broken')
    const filtered = lastRows(
        (await runner('--scope', 'all', '--filter', 'passes')).stdout,
    )
    expect(Object.keys(filtered)).toEqual(['suite/passes.test.ts'])
}, 60_000)
