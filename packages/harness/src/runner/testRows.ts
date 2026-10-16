// TEST FILES AS ROWS — one row per file, so a row lands the moment its own file finishes. One
// file per process: `bun test` files eight at a time, playwright specs one at a time, because every
// spec under one config shares the servers and ports its `webServer` starts.
//
// THE SUITES ARE THE CALLER'S. A runner script names which directories hold which kind of file and
// calls this; `--list`, `--scope` and `--filter` are `rowsCommand`'s, and `--gates` runs every
// `gate()`'s revert as well (RULEBOOK 43.9).

import type { RowItem, TestRow } from '../rows/index.ts'
import { rowsCommand } from './rowsCommand.ts'
import { BUN_REPORT, PLAYWRIGHT_REPORT, runSuite } from './runSuite.ts'

// The worker count is not a lever (CLAUDE.md, "checks"), so this is only "enough to keep a
// machine busy without every file timing out against the others".
const BUN_WIDTH = 8

/**
 * One directory of test files, listed under one section.
 *
 * `bun` runs every `*.test.ts` below `root`; `playwright` runs every `*.spec.ts` directly in it,
 * in the named projects, so a spec runs in the projects its directory is served by. `pattern`
 * replaces either glob, relative to `root`.
 */
export type TestSuite =
    | { section: string; root: string; runner: 'bun'; pattern?: string }
    | {
          section: string
          root: string
          runner: 'playwright'
          projects: string[]
          pattern?: string
      }

type TestItem = RowItem & { command: string[]; browser: boolean }

function testFiles(cwd: string, root: string, pattern: string): string[] {
    const files: string[] = []
    for (const file of new Bun.Glob(pattern).scanSync({
        cwd: `${cwd}/${root}`,
    }))
        if (!file.includes('node_modules/')) files.push(`${root}/${file}`)
    return files.sort()
}

function itemsOf(suites: TestSuite[], cwd: string): TestItem[] {
    const all: TestItem[] = []
    for (const suite of suites) {
        if (suite.runner === 'bun') {
            for (const file of testFiles(
                cwd,
                suite.root,
                suite.pattern ?? '**/*.test.ts',
            ))
                all.push({
                    id: file,
                    section: suite.section,
                    name: file.slice(suite.root.length + 1),
                    // `./` or bun reads the path as a name filter.
                    command: ['bun', 'test', `./${file}`],
                    browser: false,
                })
            continue
        }
        const named: string[] = []
        for (const project of suite.projects) named.push('--project', project)
        for (const file of testFiles(
            cwd,
            suite.root,
            suite.pattern ?? '*.spec.ts',
        ))
            all.push({
                id: file,
                section: suite.section,
                name: file.slice(suite.root.length + 1),
                command: ['bunx', 'playwright', 'test', file, ...named],
                browser: true,
            })
    }
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
        cases: [],
        note: '',
    }
}

async function runOne(
    item: TestItem,
    gates: boolean,
    cwd: string,
): Promise<TestRow> {
    const row = emptyRow(item.id, 'done')
    try {
        const { suites, milliseconds } = await runSuite({
            command: item.command,
            reportTo: item.browser ? PLAYWRIGHT_REPORT : BUN_REPORT,
            cwd,
            environment: gates ? { HARNESS_VERIFY_GATES: '1' } : {},
        })
        row.milliseconds = milliseconds
        for (const suite of suites) {
            row.tests += suite.tests
            row.failures += suite.failures
            row.skipped += suite.skipped
            for (const one of suite.cases) row.cases.push(one)
        }
    } catch (error) {
        row.state = 'broken'
        row.note = error instanceof Error ? error.message : String(error)
    }
    return row
}

/** A fixed number of workers pulling from one queue, so a row lands when its own file finishes. */
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

/**
 * Lists `suites` as rows under `--list`, or runs the files `--scope` and `--filter` select and
 * prints one `TestRow` per line as each file finishes. `cwd` is what every suite's `root` is
 * relative to, and where each file runs.
 */
export async function testRows(
    suites: TestSuite[],
    cwd: string,
): Promise<void> {
    await rowsCommand<TestItem, TestRow>(
        itemsOf(suites, cwd),
        async (selected, emit) => {
            const gates = process.argv.includes('--gates')
            const unitFiles: TestItem[] = []
            const browserFiles: TestItem[] = []
            for (const item of selected) {
                ;(item.browser ? browserFiles : unitFiles).push(item)
                emit(emptyRow(item.id, 'queued'))
            }
            const run = async (item: TestItem): Promise<void> => {
                emit(emptyRow(item.id, 'running'))
                emit(await runOne(item, gates, cwd))
            }
            await Promise.all([
                pool(unitFiles, BUN_WIDTH, run),
                pool(browserFiles, 1, run),
            ])
        },
    )
}
