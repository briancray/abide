// 16.53, 16.54 — A CALL'S SIGNAL. Calls with the same args join one load (1.8), so a signal is one
// caller's vote to stop waiting, not the load's off switch: the load ends when every call that
// reached it passed a signal and every one of them aborted, and a call with none keeps it going.
// Ended, the value keeps what it held and refuses `Aborted`.

import { expect, test } from 'bun:test'
import { GET } from '#server'
import { flushSync } from '#shared'
import { wire } from '#ui/wire.ts'

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

type Loading = (() => unknown) & {
    busy(): boolean
    ready(): boolean
    error(): unknown
    peek(): unknown
    refresh(): void
} & PromiseLike<unknown>

// A handler whose loads finish only when the test says so, one release per load started.
function held() {
    const releases: (() => void)[] = []
    const rpc = GET(
        ({ id }: { id: string }) =>
            new Promise<string>((done) => {
                releases.push(() => done(`invoice ${id}`))
            }),
    ) as unknown as (
        args: { id: string },
        options?: { signal?: AbortSignal },
    ) => Loading
    return { rpc, releases }
}

// THE REVERT: end the load on the FIRST abort in `holdLoad` (drop the loop over `signals`); the
// shared load ends while the second caller is still waiting, and `busy` reports false here.
test('a load two signalled calls share ends when both abort, not the first — 16.53', async () => {
    const { rpc, releases } = held()
    const first = new AbortController()
    const second = new AbortController()
    const value = rpc({ id: '1' }, { signal: first.signal })
    expect(rpc({ id: '1' }, { signal: second.signal })).toBe(value)

    first.abort()
    flushSync()
    expect(value.busy()).toBe(true)

    second.abort()
    flushSync()
    expect(value.busy()).toBe(false)
    expect((value.error() as { name: string; status: number }).name).toBe(
        'Aborted',
    )
    expect((value.error() as { status: number }).status).toBe(499)

    // What the handler answers after is a settle nobody asked for, and does not land.
    releases[0]?.()
    await tick()
    expect(value.ready()).toBe(false)
    expect(releases.length).toBe(1)
})

// THE REVERT: drop the `pinned` check in `holdLoad`; the load ends under a caller that never
// handed a signal and is still waiting on it.
test('a call with no signal keeps the load going whatever the others abort — 16.53', async () => {
    const { rpc, releases } = held()
    const signalled = new AbortController()
    const value = rpc({ id: '2' }, { signal: signalled.signal })
    rpc({ id: '2' })
    signalled.abort()
    flushSync()
    expect(value.busy()).toBe(true)
    releases[0]?.()
    expect(await value).toBe('invoice 2')
})

// 16.54 — ENDED, THE VALUE KEEPS WHAT IT HELD, as a failed revalidation does (2.4). The refresh starts
// a load no call handed a signal to; the call after it joins that load and is its only waiter.
// THE REVERT: clear the value in `abandonLoad` rather than refusing over it; the read then throws.
test('an aborted reload keeps serving what the value held — 16.54', async () => {
    const { rpc, releases } = held()
    const value = rpc({ id: '3' })
    releases[0]?.()
    expect(await value).toBe('invoice 3')

    value.refresh()
    const leaving = new AbortController()
    expect(rpc({ id: '3' }, { signal: leaving.signal })).toBe(value)
    expect(value.busy()).toBe(true)
    leaving.abort()
    flushSync()
    expect(value.busy()).toBe(false)
    expect(value()).toBe('invoice 3')
    expect((value.error() as { name: string }).name).toBe('Aborted')
})

// 16.67 — THE CALLERS STOPPED WAITING, NOT THE VALUE: a component unmounted before its first answer
// and mounted again asks for the value, not for the `Aborted` its last visit left. THE REVERT: drop
// the `ABANDONED` check from `call`; the second call joins the ended load and reads `Aborted` for
// good, with 1 load started rather than 2.
test('a call after an aborted first load starts another — 16.67', async () => {
    const { rpc, releases } = held()
    const leaving = new AbortController()
    const value = rpc({ id: '5' }, { signal: leaving.signal })
    leaving.abort()
    flushSync()
    expect((value.error() as { name: string }).name).toBe('Aborted')

    expect(rpc({ id: '5' })).toBe(value)
    expect(`loads: ${releases.length}`).toBe('loads: 2')
    expect(value.busy()).toBe(true)
    releases[1]?.()
    expect(await value).toBe('invoice 5')
})

// 16.54 ON A STREAM: what the run had said stays, and the generator is returned. One suspended in an
// `await` takes the return at its next `yield`, whose chunk is dropped (`stopStream`), so the step
// it was in finishes and nothing after it runs.
test('an aborted stream keeps the chunks it had and runs no further — 16.54', async () => {
    let finished = false
    let release = (): void => {}
    const rows = GET(async function* () {
        yield 'first'
        await new Promise<void>((done) => {
            release = done
        })
        yield 'second'
        finished = true
        yield 'third'
    }) as unknown as (
        args?: undefined,
        options?: { signal?: AbortSignal },
    ) => Loading
    const leaving = new AbortController()
    const value = rows(undefined, { signal: leaving.signal })
    await tick()
    expect(value.peek()).toEqual(['first'])
    leaving.abort()
    flushSync()
    expect(value.busy()).toBe(false)
    release()
    await tick()
    await tick()
    expect(value.peek()).toEqual(['first'])
    expect(finished).toBe(false)
})

// 16.54 — OVER A WIRE THE REQUEST ITSELF ENDS: the browser's `fetch` is handed the load's own signal,
// aborted once every caller has. THE REVERT: drop `signal` from `fetched`; the request the page
// stopped waiting for runs on, and `fetch` was handed no signal at all.
test('a load every caller aborted aborts its request — 16.54', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    let handed: AbortSignal | undefined
    window.fetch = ((_url: string, init?: RequestInit) => {
        handed = init?.signal ?? undefined
        return new Promise(() => {})
    }) as unknown
    try {
        const getInvoice = wire('GET', '/rpc/getInvoice') as (
            args: { id: string },
            options?: { signal?: AbortSignal },
        ) => Loading
        const leaving = new AbortController()
        const value = getInvoice({ id: '9' }, { signal: leaving.signal })
        expect(handed?.aborted).toBe(false)
        leaving.abort()
        flushSync()
        expect(handed?.aborted).toBe(true)
        expect(value.busy()).toBe(false)
    } finally {
        window.fetch = previous
    }
})
