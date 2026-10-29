// `runBenches` and `harness-bench` over a fixture app. `batch` throws in a parallel worker (43.18),
// so both run in a child with no worker mark.

import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs' // bun has no temporary-directory api of its own
import { tmpdir } from 'node:os' // nor a reading of the system's temporary directory
import { inAFreshProcess, spawned } from '@abide/harness/gate'

const REPORT = new URL('../src/report/index.ts', import.meta.url).pathname
const RUNNER = new URL('../src/runner/index.ts', import.meta.url).pathname
const BIN = new URL('../src/runner/harnessBench.ts', import.meta.url).pathname

const APP = mkdtempSync(`${tmpdir()}/harness-bench-`)
await Bun.write(
    `${APP}/src/over.bench.ts`,
    `import { batch } from '${REPORT}'
let sink = 0
export const CEILINGS = { two: { first: 0, absent: 1000 } }
export function two() {
    return batch({ case: 'two arms', emulated: null, arms: { first: () => { sink += 1 }, second: () => { sink += 2 } } })
}
export function one() {
    return batch({ case: 'one arm', emulated: null, arms: { only: () => { sink += 1 } } })
}
`,
)
await Bun.write(
    `${APP}/src/lib/under.bench.ts`,
    `import { batch } from '${REPORT}'
let sink = 0
export const CEILINGS = { roomy: { only: 1000 } }
export function roomy() {
    return batch({ case: 'roomy', emulated: null, arms: { only: () => { sink += 1 } } })
}
`,
)

// The child's environment, with the worker mark this test may be running under taken off.
const ENVIRONMENT: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== 'BUN_TEST_WORKER_ID')
        ENVIRONMENT[key] = value

type Bench = Awaited<
    ReturnType<typeof import('../src/runner/runBenches.ts').runBenches>
>[number]

const run = await inAFreshProcess(
    `import { runBenches } from '${RUNNER}'
console.log(JSON.stringify(await runBenches('${APP}')))`,
)
const benches = JSON.parse(
    run.output.trim().split('\n').pop() ?? '[]',
) as Bench[]

// 43.29 — every exported function is a bench, and `CEILINGS` is not one.
test('every function a bench file exports is run', () => {
    expect(run.ok).toBe(true)
    expect(benches.map((bench) => `${bench.file} ${bench.name}`)).toEqual([
        'src/lib/under.bench.ts roomy',
        'src/over.bench.ts one',
        'src/over.bench.ts two',
    ])
})

// 43.30 — the A/A control is the floor, not an arm, and one arm makes no claim.
test('the arms are the arms a bench names', () => {
    const [, one, two] = benches
    expect(Object.keys(one?.arms ?? {})).toEqual(['only'])
    expect(one?.claim).toBe('')
    expect(Object.keys(two?.arms ?? {})).toEqual(['first', 'second'])
    expect(two?.claim).toStartWith('second against first: ')
})

// 43.31, 43.32 — THE REVERT: dropping either half of the ceiling check leaves its line out, and the
// over-ceiling one leaves `harness-bench` exiting 0 below.
test('an arm over its ceiling and a ceiling naming no arm are reported', () => {
    const [roomy, one, two] = benches
    expect(roomy?.over).toEqual([])
    expect(one?.over).toEqual([])
    expect(two?.over).toHaveLength(2)
    expect(two?.over[0]).toMatch(
        /^first took [\d.]+ ms, over its ceiling of 0 ms$/,
    )
    expect(two?.over[1]).toBe('no arm "absent" to hold to its ceiling')
})

// 43.33
test('harness-bench exits 1 over a ceiling, and 0 under every one', async () => {
    const over = await spawned(['bun', BIN], { cwd: APP, env: ENVIRONMENT })
    expect(over.exitCode).toBe(1)
    expect(over.stdout).toContain('src/over.bench.ts two: two arms')
    expect(over.stderr).toContain('src/over.bench.ts two: first took ')
    expect(over.stderr).toContain(
        'src/over.bench.ts two: no arm "absent" to hold to its ceiling',
    )
    const under = await spawned(['bun', BIN, 'under'], {
        cwd: APP,
        env: ENVIRONMENT,
    })
    expect(`${under.exitCode} ${under.stderr}`).toBe('0 ')
    expect(under.stdout).toContain('src/lib/under.bench.ts roomy: roomy')
    expect(under.stdout).not.toContain('over.bench.ts')
})
