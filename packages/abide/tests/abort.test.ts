// 16.48, 16.49 — A CALL'S SIGNAL. Calls with the same args join one load (1.8), so a signal is one
// caller's vote to stop waiting, not the load's off switch: the load ends when every call that
// reached it passed a signal and every one of them aborted, and a call with none keeps it going.
// Ended, the value keeps what it held and refuses `Aborted`.

import { expect, test } from 'bun:test'

import { rpc } from '#server'
import { flushSync } from '#shared'
import { reachOf } from '#shared/rpc.ts'
import { wire } from '#ui/wire.ts'

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
    const getInvoice = rpc(
        ({ id }: { id: string }) =>
            new Promise<string>((done) => {
                releases.push(() => done(`invoice ${id}`))
            }),
    )
    const call = (
        args: { id: string },
        options?: { signal?: AbortSignal },
    ): Loading => reachOf(getInvoice, args, options) as Loading
    return { call, releases }
}

// THE REVERT: end the load on the FIRST abort in `Attended.handleEvent` (drop the loop over
// `signals`, `#shared/reactive/callLoad.ts`); the shared load ends while the second caller is still
// waiting, and `busy` reports false here.
test('a load two signaled calls share ends when both abort, not the first — 16.48', async () => {
    const { call, releases } = held()
    const first = new AbortController()
    const second = new AbortController()
    const value = call({ id: '1' }, { signal: first.signal })
    expect(call({ id: '1' }, { signal: second.signal })).toBe(value)

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
    await Bun.sleep(0)
    expect(value.ready()).toBe(false)
    expect(releases.length).toBe(1)
})

// THE REVERT: drop the `pinned` check in `Attended.handleEvent`; the load ends under a caller that never
// handed a signal and is still waiting on it.
test('a call with no signal keeps the load going whatever the others abort — 16.48', async () => {
    const { call, releases } = held()
    const signaled = new AbortController()
    const value = call({ id: '2' }, { signal: signaled.signal })
    call({ id: '2' })
    signaled.abort()
    flushSync()
    expect(value.busy()).toBe(true)
    releases[0]?.()
    expect(await value).toBe('invoice 2')
})

// 16.49 — ENDED, THE VALUE KEEPS WHAT IT HELD, as a failed revalidation does (2.4). The refresh starts
// a load no call handed a signal to; the call after it joins that load and is its only waiter.
// THE REVERT: clear the value in `abandonLoad` rather than refusing over it; the read then throws.
test('an aborted reload keeps serving what the value held — 16.49', async () => {
    const { call, releases } = held()
    const value = call({ id: '3' })
    releases[0]?.()
    expect(await value).toBe('invoice 3')

    value.refresh()
    const leaving = new AbortController()
    expect(call({ id: '3' }, { signal: leaving.signal })).toBe(value)
    expect(value.busy()).toBe(true)
    leaving.abort()
    flushSync()
    expect(value.busy()).toBe(false)
    expect(value()).toBe('invoice 3')
    expect((value.error() as { name: string }).name).toBe('Aborted')
})

// 16.62 — THE CALLERS STOPPED WAITING, NOT THE VALUE: a component unmounted before its first answer
// and mounted again asks for the value, not for the `Aborted` its last visit left. THE REVERT: drop
// the `abandoned` read from `callLoad`; the second call joins the ended load and reads `Aborted` for
// good, with 1 load started rather than 2.
test('a call after an aborted first load starts another — 16.62', async () => {
    const { call, releases } = held()
    const leaving = new AbortController()
    const value = call({ id: '5' }, { signal: leaving.signal })
    leaving.abort()
    flushSync()
    expect((value.error() as { name: string }).name).toBe('Aborted')

    expect(call({ id: '5' })).toBe(value)
    expect(`loads: ${releases.length}`).toBe('loads: 2')
    expect(value.busy()).toBe(true)
    releases[1]?.()
    expect(await value).toBe('invoice 5')
})

// 16.49 ON A STREAM: what the run had said stays, and the generator is returned. One suspended in an
// `await` takes the return at its next `yield`, whose chunk is dropped (`stopStream`), so the step
// it was in finishes and nothing after it runs.
test('an aborted stream keeps the chunks it had and runs no further — 16.49', async () => {
    let finished = false
    let release = (): void => {}
    const rows = rpc(async function* () {
        yield 'first'
        await new Promise<void>((done) => {
            release = done
        })
        yield 'second'
        finished = true
        yield 'third'
    })
    const leaving = new AbortController()
    const value = reachOf(rows, undefined, {
        signal: leaving.signal,
    }) as Loading
    await Bun.sleep(0)
    expect(value.peek()).toEqual(['first'])
    leaving.abort()
    flushSync()
    expect(value.busy()).toBe(false)
    release()
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(value.peek()).toEqual(['first'])
    expect(finished).toBe(false)
})

// 16.49 — OVER A WIRE THE REQUEST ITSELF ENDS: the browser's `fetch` is handed the load's own signal,
// aborted once every caller has. THE REVERT: drop `signal` from `fetched`; the request the page
// stopped waiting for runs on, and `fetch` was handed no signal at all.
test('a load every caller aborted aborts its request — 16.49', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    let handed: AbortSignal | undefined
    window.fetch = ((_url: string, init?: RequestInit) => {
        handed = init?.signal ?? undefined
        return new Promise(() => {})
    }) as unknown
    try {
        const getInvoice = wire('GET', '/rpc/getInvoice')
        const leaving = new AbortController()
        const value = reachOf(
            getInvoice,
            { id: '9' },
            { signal: leaving.signal },
        ) as Loading
        expect(handed?.aborted).toBe(false)
        leaving.abort()
        flushSync()
        expect(handed?.aborted).toBe(true)
        expect(value.busy()).toBe(false)
    } finally {
        window.fetch = previous
    }
})

// 16.120 — A CALL'S SIGNAL IS ITS OWN WAY OUT, on the call an app makes rather than the value it
// reached: the call that left is refused while the one with no signal is answered. THE REVERT: hand
// `answerOfCall` no `signal` in `rpc.ts`'s `call`; the call that left waits on the load, `still
// waiting, invoice 9`.
test('a call whose signal aborts is refused at once, while the load goes on — 16.120', async () => {
    const { releases } = held()
    const getInvoice = rpc(
        ({ id }: { id: string }) =>
            new Promise<string>((done) => {
                releases.push(() => done(`invoice ${id}`))
            }),
    )
    const outcome = (answer: Promise<unknown>): Promise<string> =>
        answer.then(
            (value) => `${value}`,
            (failure: { name?: string }) => `refused ${failure.name}`,
        )
    const leaving = new AbortController()
    const left = outcome(getInvoice({ id: '9' }, { signal: leaving.signal }))
    const stayed = outcome(getInvoice({ id: '9' }))
    leaving.abort()
    const leftFirst = await Promise.race([
        left,
        Bun.sleep(20).then(() => 'still waiting'),
    ])
    releases[0]?.()
    expect(`${leftFirst}, ${await stayed}`).toBe('refused Aborted, invoice 9')
})
