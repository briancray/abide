// `state` — the OWN face of the reactive atom, and the one of the three primitives that had no test
// file at all. `memo` has 1588 lines of tests and `channel` its own; `state` was exercised only
// transitively through `ui/` tests, every one of which uses a plain `state(0)`. So the two things this
// module actually adds over the raw atom — the `transform` hook and the whole `.shared` registry —
// had ZERO coverage, and a repo-wide grep for `BroadcastChannel` in any test returned nothing.
//
// The cross-tab path is reachable here, which is worth stating because the usual trap runs the other
// way: `test/happydom.ts` DELETES `globalThis.window`, so every `isBrowser` branch in `shared/` is dead
// under `bun test`. `state.ts` does not use `isBrowser` — it discriminates on `document`, which
// happy-dom keeps — so it takes the CLIENT branch here and `.shared` really does register slots and
// really does open a `BroadcastChannel`. (That divergence between the two side-predicates is
// deliberate and documented at `state.ts`; it is what makes these tests possible.)
//
// `SHARED_SLOTS` is a module-global keyed map with no reset, so every test below uses a UNIQUE key —
// a shared key is a shared slot by design, which is exactly what one of these asserts.

import { describe, expect, test } from 'bun:test'
import { state } from './state.ts'
import { watch } from './watch.ts'

let keySeq = 0
const uniqueKey = (label: string): string => `abide-test:${label}:${keySeq++}`

// Let a queued reactive flush land before reading an effect's observations.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe('state(initial)', () => {
    test('is CALLABLE for the read, with set/untracked alongside', () => {
        const count = state(1)
        expect(typeof count).toBe('function')
        expect(count()).toBe(1)
        count.set(2)
        expect(count()).toBe(2)
        expect(count.peek()).toBe(2)
    })

    test('a tracked read re-runs an effect; untracked() does NOT subscribe', async () => {
        const tracked = state(0)
        const quiet = state(0)
        let runs = 0
        const stop = watch(() => {
            tracked()
            quiet.peek()
            runs++
        })
        await flush()
        const baseline = runs

        tracked.set(1)
        await flush()
        expect(runs).toBe(baseline + 1)

        // The whole point of `untracked` having its own name (ADR 0027 D2): it reads WITHOUT
        // subscribing, which is the opposite of `peek` on a memo/channel.
        quiet.set(99)
        await flush()
        expect(runs).toBe(baseline + 1)
        stop()
    })

    test('an identical write wakes nobody', async () => {
        const value = state('a')
        let runs = 0
        const stop = watch(() => {
            value()
            runs++
        })
        await flush()
        const baseline = runs
        value.set('a')
        await flush()
        expect(runs).toBe(baseline)
        stop()
    })
})

describe('state(initial, transform)', () => {
    test('transform normalises the INITIAL value and every write', () => {
        const clamped = state(15, (n: number) => Math.max(0, Math.min(10, n)))
        expect(clamped()).toBe(10)
        clamped.set(-5)
        expect(clamped()).toBe(0)
        clamped.set(7)
        expect(clamped()).toBe(7)
    })

    test('a transform that collapses a write to the current value wakes nobody', async () => {
        const clamped = state(0, (n: number) => Math.max(0, n))
        let runs = 0
        const stop = watch(() => {
            clamped()
            runs++
        })
        await flush()
        const baseline = runs
        // Both clamp to 0, which the cell already holds.
        clamped.set(-1)
        clamped.set(-2)
        await flush()
        expect(runs).toBe(baseline)
        stop()
    })
})

describe('state.shared(key, initial)', () => {
    test('the same key is the SAME cell across instances', () => {
        const key = uniqueKey('same')
        const a = state.shared(key, 0)
        const b = state.shared(key, 999) // a later `initial` does not clobber a live slot
        expect(b()).toBe(0)
        a.set(5)
        expect(b()).toBe(5)
        b.set(6)
        expect(a()).toBe(6)
    })

    test('different keys are independent slots', () => {
        const a = state.shared(uniqueKey('x'), 1)
        const b = state.shared(uniqueKey('y'), 1)
        a.set(2)
        expect(b()).toBe(1)
    })

    test('a write through one instance wakes a reader subscribed through another', async () => {
        const key = uniqueKey('wake')
        const writer = state.shared(key, 0)
        const reader = state.shared(key, 0)
        let seen: number | undefined
        const stop = watch(() => {
            seen = reader()
        })
        await flush()
        writer.set(42)
        await flush()
        expect(seen).toBe(42)
        stop()
    })
})

describe('state.shared — the cross-tab BroadcastChannel path', () => {
    // The entire reason `.shared` exists over a plain module-level `state`, and nothing anywhere
    // exercised it. A real second tab is not available here, so the far end is driven directly: post
    // the frame another tab would have posted and assert the local slot adopts it.
    test('a remote frame for a known key updates the local slot', async () => {
        const key = uniqueKey('remote')
        const cell = state.shared(key, 'initial')
        // Reading through the cell is what opens the channel, so subscribe first.
        expect(cell()).toBe('initial')

        const far = new BroadcastChannel('abide:state:shared')
        try {
            far.postMessage({ key, value: 'from-another-tab' })
            await flush()
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(cell()).toBe('from-another-tab')
        } finally {
            far.close()
        }
    })

    test('a remote frame for an UNKNOWN key is ignored rather than creating a slot', async () => {
        const far = new BroadcastChannel('abide:state:shared')
        try {
            far.postMessage({ key: uniqueKey('never-registered'), value: 'x' })
            await new Promise((resolve) => setTimeout(resolve, 50))
            // Nothing to assert on directly — the contract is that this does not throw and does not
            // conjure a slot. A later `state.shared` on that key must still see ITS initial value.
            const late = state.shared(uniqueKey('never-registered-2'), 'mine')
            expect(late()).toBe('mine')
        } finally {
            far.close()
        }
    })

    test('a malformed frame is dropped', async () => {
        const key = uniqueKey('malformed')
        const cell = state.shared(key, 'kept')
        expect(cell()).toBe('kept')
        const far = new BroadcastChannel('abide:state:shared')
        try {
            // No `key`, a non-string `key`, and a null payload — each must leave the slot standing.
            far.postMessage({ value: 'no key' })
            far.postMessage({ key: 123, value: 'numeric key' })
            far.postMessage(null)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(cell()).toBe('kept')
        } finally {
            far.close()
        }
    })

    // `postMessage` throws on a value the structured-clone algorithm cannot handle. The write path
    // catches it deliberately: the local write has already landed, and losing the broadcast is better
    // than throwing out of `cell.set(…)`.
    test('a non-serializable value stays LOCAL instead of throwing on the write path', () => {
        const cell = state.shared<unknown>(uniqueKey('nonserializable'), null)
        expect(() => cell.set(() => 'a function cannot be structured-cloned')).not.toThrow()
        expect(typeof cell()).toBe('function')
    })
})

// THE SERVER BRANCH — the one that prevents a cross-request state leak, and the one this suite
// structurally cannot reach.
//
// Every test above takes the CLIENT branch, because `test/happydom.ts` gives the process a `document`.
// That is deliberate and is what makes the cross-tab cases possible — but it means `makeShared`'s
// `!hasDom` branch, whose whole job is "a process-global registry would hand one request's state to the
// next", has no coverage at all. The two side predicates disagreeing under test is what buys the
// coverage above and costs this.
//
// So it runs in a child `bun` with no preload and therefore no DOM — the same technique `log.test.ts`
// uses to reach the browser half of an isomorphic module, in the opposite direction.
describe('state.shared with no DOM (the server)', () => {
    test('two renders asking for one key do NOT share a slot', async () => {
        const probe = Bun.spawn(
            ['bun', `${import.meta.dir}/__fixtures__/serverSharedStateProbe.ts`],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [stdout, stderr] = await Promise.all([
            new Response(probe.stdout).text(),
            new Response(probe.stderr).text(),
        ])
        const marker = stdout.indexOf('@@')
        if (marker === -1) throw new Error(`the no-DOM probe produced no result: ${stderr}`)
        const result = JSON.parse(stdout.slice(marker + 2)) as {
            hadDom: boolean
            first: string
            second: string
            third: string
        }

        expect(result.hadDom).toBe(false)
        // The write landed on the writer's own cell…
        expect(result.first).toBe('written by the first render')
        // …and nowhere else. On the client both of these would read the written value.
        expect(result.second).toBe('initial')
        expect(result.third).toBe('initial')
    }, 20_000)
})
