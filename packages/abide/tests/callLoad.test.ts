// 16.48, 16.49, 16.59, 16.61, 16.62 — A CALL REACHING A LOAD, through `reactive` directly: the
// policy `callLoad` keeps over the core's loads, with no handler, no transport and no stubbed
// `fetch` between the test and it. `abort.test.ts` and `timeout.test.ts` hold the same clauses
// through `GET`; these hold the module those reach.

import { afterEach, expect, test } from 'bun:test'
import { flushSync, reactive } from '#shared'
import { LOAD_SIGNAL } from '#shared/LOAD_SIGNAL.ts'
import { callLoad } from '#shared/reactive/callLoad.ts'

type Loading = (() => unknown) & {
    busy(): boolean
    ready(): boolean
    error(): unknown
    peek(): unknown
    refresh(): void
} & PromiseLike<unknown>

// A keyed value whose loads finish only when the test says so, one release per load started.
function held() {
    const releases: (() => void)[] = []
    const value = reactive(
        ({ id }: { id: string }) =>
            new Promise<string>((done) => {
                releases.push(() => done(`invoice ${id}`))
            }),
    ) as unknown as (args: unknown) => Loading
    const call = (args: { id: string }, signal?: AbortSignal): Loading =>
        callLoad(value, args, signal, undefined) as Loading
    return { call, releases }
}

const nameOf = (value: Loading): string | undefined =>
    (value.error() as { name?: string } | undefined)?.name

// THE REVERT: return from `Attended.handleEvent` on the first aborted signal rather than looping over
// all of them; this reads `busy: false` after the first abort.
test('a load two signaled calls share ends when both abort — 16.48', () => {
    const { call } = held()
    const first = new AbortController()
    const second = new AbortController()
    const value = call({ id: '1' }, first.signal)
    expect(call({ id: '1' }, second.signal)).toBe(value)
    first.abort()
    flushSync()
    expect(`busy: ${value.busy()}`).toBe('busy: true')
    second.abort()
    flushSync()
    expect(`busy: ${value.busy()}`).toBe('busy: false')
    expect(nameOf(value)).toBe('Aborted')
})

// THE REVERT: drop the `pinned` check in `Attended.handleEvent`; the load is ended under a caller
// that never handed a signal, and this reads `busy: false`.
test('a call with no signal pins the load — 16.48', () => {
    const { call } = held()
    const signaled = new AbortController()
    const value = call({ id: '2' }, signaled.signal)
    call({ id: '2' })
    signaled.abort()
    flushSync()
    expect(`busy: ${value.busy()}`).toBe('busy: true')
})

// THE REVERT: drop the `abandoned` read in `callLoad`; the call joins the ended load and `loads: 1`.
test('a call after an aborted load starts another — 16.62', async () => {
    const { call, releases } = held()
    const leaving = new AbortController()
    const value = call({ id: '3' }, leaving.signal)
    leaving.abort()
    flushSync()
    expect(nameOf(value)).toBe('Aborted')
    expect(call({ id: '3' })).toBe(value)
    expect(`loads: ${releases.length}`).toBe('loads: 2')
    releases[1]?.()
    expect(await value).toBe('invoice 3')
})

// 16.49 — THE LOAD'S OWN SIGNAL reaches the body as it starts, and aborts once every caller has —
// the caller's own signal is one vote and is never the one handed on. THE REVERT: drop the
// `ending?.abort()` in `Attended.handleEvent`; the body's signal reads `aborted: false`.
test('the body a call starts is handed the load own signal — 16.49', () => {
    let handed: AbortSignal | undefined
    const value = reactive(({ id }: { id: string }) => {
        handed = LOAD_SIGNAL.current
        return new Promise<string>(() => id)
    }) as unknown as (args: unknown) => Loading
    const leaving = new AbortController()
    callLoad(value, { id: '4' }, leaving.signal, undefined)
    expect(handed === leaving.signal).toBe(false)
    expect(LOAD_SIGNAL.current).toBeUndefined()
    leaving.abort()
    flushSync()
    expect(`aborted: ${handed?.aborted}`).toBe('aborted: true')
})

// 16.59 — the 504, on a plain `reactive` with no handler around it. THE REVERT: drop the `timeLoad`
// call from `callLoad`; the load never settles and the test runs out its own timeout.
test('a load that goes its timeout refuses 504 — 16.59', async () => {
    const value = reactive(
        () => new Promise<string>(() => {}),
    ) as unknown as Loading
    callLoad(() => value, undefined, undefined, 30)
    await Promise.resolve(value).then(
        () => undefined,
        () => undefined,
    )
    expect(`busy: ${value.busy()}`).toBe('busy: false')
    expect((value.error() as { status?: number }).status).toBe(504)
})

// 16.61 — ONE CLOCK PER LOAD, counted rather than timed: three calls joining one load arm one timer.
// THE REVERT: drop the `timed` test in `callLoad`; each join arms a clock of its own, `clocks: 3`.
const realSetTimeout = globalThis.setTimeout
afterEach(() => {
    globalThis.setTimeout = realSetTimeout
})
test('calls joining a load start no clock of their own — 16.61', async () => {
    let release = (): void => {}
    const value = reactive(
        () =>
            new Promise<string>((done) => {
                release = () => done('settled')
            }),
    ) as unknown as Loading
    let clocks = 0
    globalThis.setTimeout = ((run: () => void, ms?: number) => {
        clocks += 1
        return realSetTimeout(run, ms)
    }) as typeof setTimeout
    const reach = (): unknown => value
    callLoad(reach, undefined, undefined, 60_000)
    callLoad(reach, undefined, undefined, 60_000)
    callLoad(reach, undefined, undefined, 60_000)
    globalThis.setTimeout = realSetTimeout
    // Settled, so the clock it armed is cleared rather than left pending past the test.
    release()
    await value
    expect(`clocks: ${clocks}`).toBe('clocks: 1')
})
