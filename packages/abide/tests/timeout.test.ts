// 16.13, 16.62 TO 16.65 — `timeout` ON EVERY CALL, in process as over the wire: a load that goes that
// long without progress — its answer, or a stream's next chunk — is ended where it stands and refuses
// 504, keeping what the value held. One clock per load, which a joining call does not wind back.

import { afterEach, expect, test } from 'bun:test'
import { GET } from '#server'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'

type Loading = (() => unknown) & {
    busy(): boolean
    ready(): boolean
    error(): unknown
    peek(): unknown
    refresh(): void
} & PromiseLike<unknown>

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
test('a load that goes its timeout without settling refuses 504 — 16.63', async () => {
    const never = GET(() => new Promise<string>(() => {}), {
        timeout: 40,
    }) as unknown as () => Loading
    const value = never()
    expect(value.busy()).toBe(true)
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(value.error()).toMatchObject({ name: 'HttpError', status: 504 })
})

// PER CHUNK, NOT PER RUN: four chunks 25 ms apart run 100 ms under a 60 ms timeout. THE REVERT: drop
// the `arm()` in the cursor loop; the clock runs from the first call and the run is ended at 60 ms.
test('a stream that keeps producing outlives its timeout — 16.63', async () => {
    const rows = GET(
        async function* () {
            for (let row = 0; row < 4; row += 1) {
                await Bun.sleep(25)
                yield row
            }
        },
        { timeout: 60 },
    ) as unknown as () => Loading
    const value = rows()
    await settled(value)
    expect(value.error()).toBeUndefined()
    expect(value.peek()).toEqual([0, 1, 2, 3])
})

// AND BEHIND A RUNG, where the value only turns out to stream once the onion resolves (9.20). THE
// REVERT: ask `isStreaming` once, synchronously, in `timeLoad`; the run is ended 504 at 60 ms.
test('a stream behind a rung that keeps producing outlives its timeout — 16.63, 9.20', async () => {
    const outside = RPC_SERVER.request
    RPC_SERVER.request = () => new Request('http://timeout.example/')
    try {
        const rows = GET(
            async function* () {
                for (let row = 0; row < 4; row += 1) {
                    await Bun.sleep(25)
                    yield row
                }
            },
            { timeout: 60, middleware: [(next) => next()] },
        ) as unknown as () => Loading
        const value = rows()
        await settled(value)
        expect(value.error()).toBeUndefined()
        expect(value.peek()).toEqual([0, 1, 2, 3])
    } finally {
        RPC_SERVER.request = outside
    }
})

// 16.64 — WHAT THE RUN HAD SAID STAYS, and the generator is stopped. THE REVERT: drop `timeLoad`; the
// stream never ends and `busy` still reads true.
test('a stream that stops producing is ended with the chunks it had — 16.63, 16.64', async () => {
    let after = false
    const rows = GET(
        async function* () {
            yield 'first'
            await Bun.sleep(150)
            after = true
            yield 'second'
        },
        { timeout: 40 },
    ) as unknown as () => Loading
    const value = rows()
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(statusOf(value)).toBe(504)
    expect(value.peek()).toEqual(['first'])
    await Bun.sleep(150)
    expect(value.peek()).toEqual(['first'])
    expect(after).toBe(true)
})

// 16.64 — A RELOAD THAT TIMES OUT KEEPS SERVING WHAT THE VALUE HELD, as 16.53's abort does. THE
// REVERT: clear the value in `abandonLoad` rather than refusing over it; the read then throws.
test('a reload that times out keeps serving what the value held — 16.64', async () => {
    let calls = 0
    const invoice = GET(
        () => {
            calls += 1
            return calls === 1
                ? Promise.resolve('invoice 1')
                : new Promise<string>(() => {})
        },
        { timeout: 40 },
    ) as unknown as () => Loading
    const value = invoice()
    expect(await value).toBe('invoice 1')
    value.refresh()
    expect(invoice()).toBe(value)
    await settled(value)
    expect(value.busy()).toBe(false)
    expect(value()).toBe('invoice 1')
    expect(statusOf(value)).toBe(504)
})

// 16.65 — ONE CLOCK PER LOAD. A call joining at 150 ms does not start the 200 ms over: the refusal
// lands at 200, where a joined call's own clock would have held it to 350. THE REVERT: have a call
// that finds its load already timed re-arm that load's clock (drop the `timed` test in `callLoad`);
// the load runs to 350.
test('a call joining a load does not extend its timeout — 16.65', async () => {
    const never = GET(() => new Promise<string>(() => {}), {
        timeout: 200,
    }) as unknown as () => Loading
    const started = performance.now()
    const value = never()
    await Bun.sleep(150)
    expect(never()).toBe(value)
    await settled(value)
    expect(statusOf(value)).toBe(504)
    expect(performance.now() - started).toBeLessThan(300)
})

// 16.62 — the environment's `timeout`, which a server fills through `RPC_SERVER`, for a handler that
// names none. THE REVERT: time the load by `rpc.timeout` alone in `call`; nothing ends it.
test('a handler naming no timeout takes the environment one — 16.62', async () => {
    RPC_SERVER.timeout = () => 40
    const never = GET(
        () => new Promise<string>(() => {}),
    ) as unknown as () => Loading
    const value = never()
    await settled(value)
    expect(statusOf(value)).toBe(504)
})
