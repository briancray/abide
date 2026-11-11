// `poll` — A REFRESH ON A CLOCK (RULEBOOK 7.20 through 7.25). Every claim is a count of body runs:
// a poll that kept running past its value, or one that superseded its own load, still serves a
// right-looking value.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { reactive } from '#shared'
import { collectWatches } from '#shared/reactive/watch.ts'

/** Runs `build` as a component's setup is run, and answers what ends it. */
function inSetup(build: () => void): () => void {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    build()
    collectWatches(previous)
    return () => {
        for (const stop of stops) stop()
    }
}

// 7.20 AND 7.23: THE BODY RUNS ON THE CLOCK, AND STOPS WITH ITS OWNER. A value built in a setup is
// refreshed every `poll` while the setup stands, and never once it has ended.
//
// THE REVERT: drop the `owned(stop)` from `createReactive`, and `after the owner ended: 5` where `0`
// is due.
test('poll runs the body on its interval and stops with the owner that built it — 7.20, 7.23', async () => {
    let runs = 0
    const end = inSetup(() => {
        reactive(
            () => {
                runs += 1
                return runs
            },
            { poll: 15 },
        )
    })
    expect(`at construction: ${runs}`).toBe('at construction: 1')
    await Bun.sleep(100)
    expect(runs).toBeGreaterThanOrEqual(3)
    end()
    const atEnd = runs
    await Bun.sleep(60)
    expect(`after the owner ended: ${runs - atEnd}`).toBe(
        'after the owner ended: 0',
    )
})

// 7.21: A POLL OVER A LOAD IN FLIGHT WAITS FOR IT. A refresh supersedes the load it finds, so a
// producer slower than its interval polled blindly never lands at all.
//
// THE REVERT: have `refreshIdle` refresh unconditionally, and `ready: false` with every run
// superseded, where `ready: true` is due.
test('poll does not refresh a value whose load is still in flight — 7.21', async () => {
    let runs = 0
    let slowValue: { ready(): boolean } | undefined
    const end = inSetup(() => {
        const slow = reactive(
            async () => {
                runs += 1
                await Bun.sleep(40)
                return runs
            },
            { poll: 5 },
        )
        slowValue = slow
    })
    await Bun.sleep(150)
    end()
    expect(`ready: ${slowValue?.ready()}`).toBe('ready: true')
    // ~150 / 45 loads, where a blind poll would start one per 5 ms.
    expect(runs).toBeLessThanOrEqual(6)
})

// 7.20 AND 7.23 ON A KEYED VALUE: ONE CLOCK OVER THE ENTRIES IT HOLDS, stopped with the `Keyed`.
//
// THE REVERT: drop the `owned(stop)` from `createKeyed`, and each entry ran 3 more times after it
// ended, `after: 10,10` where `7,7` was due.
test('poll on a keyed value refreshes every entry it holds, and stops with it — 7.20, 7.23', async () => {
    const runs = new Map<number, number>()
    const end = inSetup(() => {
        const row = reactive(
            (args: { id: number }) => {
                runs.set(args.id, (runs.get(args.id) ?? 0) + 1)
                return args.id
            },
            { poll: 15 },
        )
        row({ id: 1 })
        row({ id: 2 })
    })
    await Bun.sleep(100)
    expect(runs.get(1)).toBeGreaterThanOrEqual(3)
    expect(runs.get(2)).toBeGreaterThanOrEqual(3)
    end()
    const atEnd = [runs.get(1), runs.get(2)].join(',')
    await Bun.sleep(60)
    expect(`after: ${[runs.get(1), runs.get(2)].join(',')}`).toBe(
        `after: ${atEnd}`,
    )
})

// 7.25: A POLL OF NOTHING IS A REFRESH PER TURN, and refused where the value is built.
test('a poll that is not a positive number is refused at construction — 7.25', () => {
    expect(() => reactive(() => 1, { poll: 0 })).toThrow(
        'A poll is a positive number of milliseconds',
    )
    expect(() =>
        reactive((args: { id: number }) => args.id, { poll: -1 }),
    ).toThrow('A poll is a positive number of milliseconds')
})

// 7.22: A POLLED VALUE NOBODY ENDS DOES NOT KEEP THE PROCESS ALIVE. A module-level value polls for
// the life of the process, and a script or a test run that builds one still exits.
//
// THE REVERT: drop the `unref` from `ownedPoll`, and the child never exits — `did not finish in 5000 ms`.
test('a poll does not hold the process open — 7.22', async () => {
    const source = `import { reactive } from '${import.meta.dir}/../src/shared/index.ts'
reactive(() => 1, { poll: 50, global: true })()
reactive((args: { id: number }) => args.id, { poll: 50 })({ id: 1 })()`
    const ran = await spawned(['bun', '-e', source], { deadline: 5_000 })
    expect(`exit: ${ran.exitCode}`, ran.stderr).toBe('exit: 0')
}, 10_000)
