// EVERY TEST FILE IN THE REPO, AS ROWS — what the docs app's tests page lists and runs. One file
// per process: `bun test` files eight at a time, playwright specs one at a time, because every
// spec shares the one app server and port its config starts.
//
// `bun packages/harness/scripts/testRows.ts --list`, or `--scope all --filter reactive`, from the
// repo root. `--gates` runs every `gate()`'s revert as well (RULEBOOK 44.9).

import { rowsCommand } from './rowsCommand.ts'
import type { RowItem, TestRow } from './rows.ts'
import { BUN_REPORT, PLAYWRIGHT_REPORT, runSuite } from './runSuite.ts'

const REPO = new URL('../../../', import.meta.url).pathname

// The worker count is not a lever (CLAUDE.md, "checks"), so this is only "enough to keep a
// machine busy without every file timing out against the others".
const BUN_WIDTH = 8

type TestItem = RowItem & { command: string[]; browser: boolean }

function testFiles(root: string, pattern: string): string[] {
    const files: string[] = []
    for (const file of new Bun.Glob(pattern).scanSync({
        cwd: `${REPO}${root}`,
    }))
        if (!file.includes('node_modules/')) files.push(`${root}/${file}`)
    return files.sort()
}

function items(): TestItem[] {
    const all: TestItem[] = []
    const unit = (section: string, root: string): void => {
        for (const file of testFiles(root, '**/*.test.ts'))
            all.push({
                id: file,
                section,
                name: file.slice(root.length + 1),
                // `./` or bun reads the path as a name filter.
                command: ['bun', 'test', `./${file}`],
                browser: false,
            })
    }
    // NAMED PROJECTS, so a spec runs in the projects its directory is served by — the app pair
    // for the docs app's specs, both engines for the harness's.
    const browser = (
        section: string,
        root: string,
        projects: string[],
    ): void => {
        const named: string[] = []
        for (const project of projects) named.push('--project', project)
        for (const file of testFiles(root, '*.spec.ts'))
            all.push({
                id: file,
                section,
                name: file.slice(root.length + 1),
                command: ['bunx', 'playwright', 'test', file, ...named],
                browser: true,
            })
    }
    unit('abide', 'packages/abide/tests')
    unit('harness', 'packages/harness/tests')
    unit('dogfood', 'packages/dogfood/tests')
    browser('browser · docs app', 'packages/dogfood/e2e', ['root', 'sub-path'])
    browser('browser · harness', 'packages/harness/e2e', [
        'harness',
        'harness-webkit',
    ])
    return all
}

function emptyRow(id: string, state: TestRow['state']): TestRow {
    return {
        id,
        state,
        tests: 0,
        failures: 0,
        skipped: 0,
        milliseconds: 0,
        failed: [],
        note: '',
    }
}

async function runOne(item: TestItem, gates: boolean): Promise<TestRow> {
    const row = emptyRow(item.id, 'done')
    try {
        const { suites, milliseconds } = await runSuite({
            command: item.command,
            reportTo: item.browser ? PLAYWRIGHT_REPORT : BUN_REPORT,
            cwd: REPO,
            environment: gates ? { HARNESS_VERIFY_GATES: '1' } : {},
        })
        row.milliseconds = milliseconds
        for (const suite of suites) {
            row.tests += suite.tests
            row.failures += suite.failures
            row.skipped += suite.skipped
            for (const one of suite.cases)
                if (one.failure !== null)
                    row.failed.push({ name: one.name, failure: one.failure })
        }
    } catch (error) {
        row.state = 'broken'
        row.note = error instanceof Error ? error.message : String(error)
    }
    return row
}

// A fixed number of workers pulling from one queue, so a row lands when its own file finishes.
async function pool<Item>(
    queue: Item[],
    width: number,
    work: (item: Item) => Promise<void>,
): Promise<void> {
    let next = 0
    const workers: Promise<void>[] = []
    for (let at = 0; at < Math.min(width, queue.length); at += 1)
        workers.push(
            (async () => {
                while (next < queue.length) await work(queue[next++] as Item)
            })(),
        )
    await Promise.all(workers)
}

if (import.meta.main)
    await rowsCommand<TestItem, TestRow>(items(), async (selected, emit) => {
        const gates = process.argv.includes('--gates')
        const unitFiles: TestItem[] = []
        const browserFiles: TestItem[] = []
        for (const item of selected) {
            ;(item.browser ? browserFiles : unitFiles).push(item)
            emit(emptyRow(item.id, 'queued'))
        }
        const run = async (item: TestItem): Promise<void> => {
            emit(emptyRow(item.id, 'running'))
            emit(await runOne(item, gates))
        }
        await Promise.all([
            pool(unitFiles, BUN_WIDTH, run),
            pool(browserFiles, 1, run),
        ])
    })
