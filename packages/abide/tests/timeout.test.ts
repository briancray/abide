// 16.12, 16.58 TO 16.61 — `timeout` ON EVERY CALL, in process as over the wire: a load that goes that
// long without its answer, or a stream without its first chunk, is ended where it stands and refuses
// 504, keeping what the value held. One clock per load, which a joining call does not wind back.

import { afterEach, expect, test } from 'bun:test'

import { rpc } from '#server'
import { reactive } from '#shared'
import { reachOf } from '#shared/rpc.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'

type Loading = (() => unknown) & {
    busy(): boolean
    ready(): boolean
    error(): unknown
    peek(): unknown
    refresh(): void
} & PromiseLike<unknown>

const reach = (rpc: unknown): Loading => reachOf(rpc) as Loading

const settled = (value: Loading): Promise<unknown> =>
    Promise.resolve(value).then(
        () => undefined,
        () => undefined,
    )

const statusOf = (value: Loading): number | undefined =>
    (value.error() as { status?: number } | undefined)?.status

afterEach(() => {
    RPC_SERVER.timeout = () => undefined
})

// THE REVERT: drop the `timeLoad` call from `callLoad` in `#shared/reactive/callLoad.ts`; the load never settles and
// `busy` still reads true.
test('a load that goes its timeout without settling refuses 504 — 16.59', async () => {
    const never = rpc(() => new Promise<string>(() => {}), {
        timeout: 40,
    })
    const value = reach(never)
    expect(value.busy()).toBe(true)
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(value.error()).toMatchObject({ name: 'HttpError', status: 504 })
})

// PAST WHAT `setTimeout` HOLDS — 2^31 - 1 ms — a delay runs after 1 ms. THE REVERT: arm `timeLoad`'s
// timer with `milliseconds` uncapped; the load is refused 504 before it answers at 30 ms.
test('a timeout past what a timer holds does not end the load at once — 16.59', async () => {
    const slow = rpc(
        async () => {
            await Bun.sleep(30)
            return 'answered'
        },
        { timeout: Number.MAX_SAFE_INTEGER },
    )
    const value = reach(slow)
    await settled(value)
    expect(statusOf(value)).toBeUndefined()
    expect(value.peek()).toBe('answered')
})

// A STREAM THAT HAS BEGUN KEEPS ITS OWN PACE: a feed quiet for 150 ms after its first chunk, under a
// 40 ms timeout, is not ended — a ledger's tail waits on an append that has not been made. THE REVERT:
// arm the clock again per chunk in `timeLoad` rather than ending it at the first; the run is ended 504
// with `['first']`.
test('a stream quiet after its first chunk outlives its timeout — 16.59', async () => {
    const rows = rpc(
        async function* () {
            yield 'first'
            await Bun.sleep(150)
            yield 'second'
        },
        { timeout: 40 },
    )
    const value = reach(rows)
    await settled(value)
    expect(value.error()).toBeUndefined()
    expect(value.peek()).toEqual(['first', 'second'])
})

// AND BEHIND A RUNG, where the value only turns out to stream once the onion resolves (9.6). THE
// REVERT: ask `isStreaming` once, synchronously, in `timeLoad`; the clock waits on a settling the
// stream never makes, and the run is ended 504 at 40 ms.
test('a stream behind a rung quiet after its first chunk outlives its timeout — 16.59, 9.6', async () => {
    const outside = RPC_SERVER.request
    RPC_SERVER.request = () => new Request('http://timeout.example/')
    try {
        const rows = rpc(
            async function* () {
                yield 'first'
                await Bun.sleep(150)
                yield 'second'
            },
            { timeout: 40, middleware: [(next) => next()] },
        )
        const value = reach(rows)
        await settled(value)
        expect(value.error()).toBeUndefined()
        expect(value.peek()).toEqual(['first', 'second'])
    } finally {
        RPC_SERVER.request = outside
    }
})

// 16.59 TIMES THE FIRST CHUNK: a stream that says nothing for its timeout is ended 504, and the
// generator stopped (16.60). THE REVERT: drop `timeLoad`; the stream never ends and `busy` still reads
// true.
test('a stream with no first chunk inside its timeout is ended — 16.59, 16.60', async () => {
    let after = false
    const rows = rpc(
        async function* () {
            await Bun.sleep(150)
            after = true
            yield 'late'
        },
        { timeout: 40 },
    )
    const value = reach(rows)
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(statusOf(value)).toBe(504)
    await Bun.sleep(150)
    expect(value.peek()).toBeUndefined()
    expect(after).toBe(true)
})

// 16.60 — A RELOAD THAT TIMES OUT KEEPS SERVING WHAT THE VALUE HELD, as 16.49's abort does. THE
// REVERT: clear the value in `abandonLoad` rather than refusing over it; the read then throws.
test('a reload that times out keeps serving what the value held — 16.60', async () => {
    let calls = 0
    const invoice = rpc(
        () => {
            calls += 1
            return calls === 1
                ? Promise.resolve('invoice 1')
                : new Promise<string>(() => {})
        },
        { timeout: 40 },
    )
    const value = reach(invoice)
    expect(await value).toBe('invoice 1')
    value.refresh()
    expect(reach(invoice)).toBe(value)
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(value()).toBe('invoice 1')
    expect(statusOf(value)).toBe(504)
})

// 16.61 — ONE CLOCK PER LOAD. A call joining at 150 ms does not start the 200 ms over: the refusal
// lands at 200, where a joined call's own clock would have held it to 350. ORDERED BY THE TIMER
// QUEUE rather than read off the wall clock: a timer armed at the join for 100 ms is due at 250 or
// later — after the load's clock at 200, before a re-armed one at 350 — and timers fire in the
// order they fall due however late a loaded process runs them. THE REVERT: have a call that finds
// its load already timed re-arm that load's clock — `timeLoad` on every call, clearing the timer
// the call before it armed; the load is still busy at the checkpoint. Dropping the `timed` test in
// `callLoad` alone is not that revert: each call then arms a clock of its own, and the first still
// ends the load at 200.
test('a call joining a load does not extend its timeout — 16.61', async () => {
    const never = rpc(() => new Promise<string>(() => {}), {
        timeout: 200,
    })
    const value = reach(never)
    await Bun.sleep(150)
    expect(reach(never)).toBe(value)
    const busyAtCheckpoint = await new Promise((done) =>
        setTimeout(() => done(value.busy()), 100),
    )
    expect(`busy at the checkpoint: ${busyAtCheckpoint}`).toBe(
        'busy at the checkpoint: false',
    )
    await settled(value)
    expect(statusOf(value)).toBe(504)
})

// 16.58 — the environment's `timeout`, which a server fills through `RPC_SERVER`, for a handler that
// names none. THE REVERT: time the load by `rpc.timeout` alone in `reachCall`; nothing ends it.
test('a handler naming no timeout takes the environment one — 16.58', async () => {
    RPC_SERVER.timeout = () => 40
    const never = rpc(() => new Promise<string>(() => {}))
    const value = reach(never)
    await settled(value)
    expect(statusOf(value)).toBe(504)
})

// 16.107, 16.59 — A derived `reactive` ADOPTING A CALL THAT TIMES OUT REFUSES 504 ONCE: the read the call made
// is let go with the adoption, so the refusal does not run the body again into a new load (16.62).
// Counted as handler runs, which the value cannot show. THE REVERT: drop the cursor step back in
// `run`'s adoption of a call's answer; the body calls again on each 504 and `runs` climbs past 1.
test('a computed adopting a call that times out refuses once — 16.107, 16.59', async () => {
    let runs = 0
    const ask = rpc(
        async function* ({ q }: { q: string }) {
            runs += 1
            await Bun.sleep(300)
            yield q
        },
        { timeout: 40 },
    )
    const answer = reactive(() => ask({ q: 'a' }))
    answer.busy()
    await Bun.sleep(200)
    expect(
        `busy: ${answer.busy()}, status: ${(answer.error() as { status?: number } | undefined)?.status}, runs: ${runs}`,
    ).toBe('busy: false, status: 504, runs: 1')
})
