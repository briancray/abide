// 38.186 — WHAT A NATIVE APP OPENED FROM THE FINDER PRINTS, in a file under a folder named for its
// `APP_DATA_DIR`. Each child's output is a pipe, as launchd's /dev/null is not a terminal, and its
// home is a directory of the test's own.

import { expect, test } from 'bun:test'
import { mkdtemp, readdir } from 'node:fs/promises' // bun exposes no temporary directory creation or directory listing of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

const MODULE = JSON.stringify(`${import.meta.dir}/../src/server/keepLogFile.ts`)

// The size check, held rather than run on its minute, as `check()`.
const HELD_CHECK = `let check
globalThis.setInterval = (run) => ((check = run), { unref() {} })`
const KEEP = `keepLogFile('/Users/someone/Library/Application Support/ledger/', 'ledger', '1.4.0')`

const launch = (home: string, body: string) =>
    spawned(
        [
            'bun',
            '-e',
            `const { keepLogFile } = await import(${MODULE})
${body}`,
        ],
        { env: { ...process.env, HOME: home } },
    )

// THE REVERT is `openLogFile` answering `undefined` at once: every line reaches the pipe, and no
// file is written.
test.skipIf(process.platform !== 'darwin')(
    'each launch writes its own log under a header, and keeps four before it — 38.186',
    async () => {
        const home = await mkdtemp(`${tmpdir()}/abide-logs-`)
        for (let run = 1; run <= 6; run += 1) {
            const ran = await launch(
                home,
                `${KEEP}; console.log('run ${run} out'); console.error('run ${run} err')`,
            )
            expect(ran.exitCode).toBe(0)
            expect(ran.stdout + ran.stderr).toBe('')
        }
        const logs = `${home}/Library/Logs/ledger`
        expect((await readdir(logs)).sort()).toEqual([
            'ledger.1.log',
            'ledger.2.log',
            'ledger.3.log',
            'ledger.4.log',
            'ledger.log',
        ])
        const current = await Bun.file(`${logs}/ledger.log`).text()
        expect(current).toMatch(
            /^# ledger 1\.4\.0 launched \S+, pid \d+\.\n# a line from `log` is tab-separated/,
        )
        expect(current.endsWith('run 6 out\nrun 6 err\n')).toBe(true)
        expect(await Bun.file(`${logs}/ledger.4.log`).text()).toContain(
            'run 2 out',
        )
    },
)

// THE REVERT is the folder named for the package alone: a second build with an `APP_DATA_DIR` of its
// own writes into `ledger/` where `ledger-dev/` is due, and the two builds share one log.
test.skipIf(process.platform !== 'darwin')(
    'the log folder follows APP_DATA_DIR — 38.186',
    async () => {
        const home = await mkdtemp(`${tmpdir()}/abide-logs-`)
        const ran = await launch(
            home,
            `keepLogFile('/tmp/ledger-dev', 'ledger', '1.4.0'); console.log('dev')`,
        )
        expect(ran.exitCode).toBe(0)
        expect(await readdir(`${home}/Library/Logs`)).toEqual(['ledger-dev'])
        expect(
            await Bun.file(`${home}/Library/Logs/ledger-dev/ledger.log`).text(),
        ).toEndWith('dev\n')
    },
)

// THE REVERT is the size check never setting the file aside: the 6 MB stays in `ledger.log`.
test.skipIf(process.platform !== 'darwin')(
    'a log past one read is set aside for a new one — 38.186',
    async () => {
        const home = await mkdtemp(`${tmpdir()}/abide-logs-`)
        const ran = await launch(
            home,
            `${HELD_CHECK}
${KEEP}
console.log('x'.repeat(6 * 1024 * 1024))
check()
console.log('after')`,
        )
        expect(ran.exitCode).toBe(0)
        const logs = `${home}/Library/Logs/ledger`
        expect(await Bun.file(`${logs}/ledger.log`).text()).toMatch(
            /^# ledger 1\.4\.0 continued from ledger\.1\.log .*\nafter\n$/s,
        )
        expect(Bun.file(`${logs}/ledger.1.log`).size).toBeGreaterThan(
            6 * 1024 * 1024,
        )
    },
)
