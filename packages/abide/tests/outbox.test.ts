// 16.81 TO 16.85 AND 46 — A CALL A BROWSER COULD NOT DELIVER, against a `fetch` that can be taken off
// the network: a `GET` settles to its stand-in and asks again once there is a network, a mutation is
// queued and sent in its turn, and `outbox` shows the line. What is gated is the SENDS — how many,
// in what order, under which key — as much as what each call settles to, because a queue that sent
// twice or out of order still settles every call to the right value.

import { afterAll, afterEach, expect, test } from 'bun:test'
import { busy, outbox } from '#shared'
import { deliver } from '#ui/outboxQueue.ts'
import { wire } from '#ui/wire.ts'

type Sent = { method: string; path: string; key: string | null }

const sent: Sent[] = []
let network = true
// What the next send of a path is answered with, where it is not the default.
const answers = new Map<string, () => Response>()
const unstubbedSocket = globalThis.WebSocket
const unstubbedFetch = globalThis.fetch
globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 0
    send(): void {}
} as unknown as typeof WebSocket
globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://app.test').pathname
    sent.push({
        method: init?.method ?? 'GET',
        path,
        key: new Headers(init?.headers).get('idempotency-key'),
    })
    if (!network) throw new TypeError('Failed to fetch')
    const answer = answers.get(path)
    if (answer !== undefined) return answer()
    return Response.json({ from: 'server', path })
}) as unknown as typeof fetch
afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
    globalThis.fetch = unstubbedFetch
})
afterEach(async () => {
    // Dropped while the network is still off, so a retry the test left armed has nothing to send.
    for (let tries = 0; outbox().length !== 0 && tries < 10; tries += 1) {
        for (const call of outbox()) call.discard()
        await settle()
    }
    network = true
    answers.clear()
    sent.length = 0
})

const settle = (ms = 10): Promise<void> =>
    new Promise((done) => setTimeout(done, ms))

/** Sends the line and waits for it to land. */
async function delivered(): Promise<void> {
    deliver()
    await settle(30)
}

type Call = PromiseLike<unknown> & {
    (): unknown
    synced(): boolean
    error(): unknown
}
type Caller = (
    args: Record<string, unknown>,
    options?: { offline?: (args: Record<string, unknown>) => unknown },
) => Call

// 16.81, 16.85 — A `GET` WITH NO ANSWER SETTLES TO ITS STAND-IN, written here rather than produced,
// and asks the network again once it is back; the answer it then gets is the server's. THE REVERT:
// return `value` in place of `standIn(value)` in the wire's `stoodIn`; the stand-in reads synced.
test('a GET with no answer settles to its stand-in until the network answers — 16.81, 16.85', async () => {
    const getNote = wire('GET', '/rpc/getNote') as Caller
    network = false
    const note = getNote({ id: '1' }, { offline: () => ({ from: 'device' }) })
    expect(await note).toEqual({ from: 'device' })
    expect(note.synced()).toBe(false)
    network = true
    await settle(30)
    expect(note()).toEqual({ from: 'server', path: '/rpc/getNote' })
    expect(note.synced()).toBe(true)
})

// 16.81 — A STAND-IN IS FOR A COPY HOLDING NOTHING: a refresh that gets no answer keeps what the copy
// was answered. THE REVERT: drop the `first` test from the wire's `settle`; the refresh trades the
// server's note for the default.
test('a refresh with no answer keeps what the copy holds — 16.81', async () => {
    const getNote = wire('GET', '/rpc/getNote') as Caller
    const note = getNote({ id: '2' }, { offline: () => ({ from: 'device' }) })
    await note
    network = false
    ;(note as unknown as { refresh(): void }).refresh()
    await settle()
    expect(note()).toEqual({ from: 'server', path: '/rpc/getNote' })
})

// 16.85 — A COPY THE WORKER KEPT IS NOT THE SERVER'S ANSWER, however it got here. THE REVERT: return
// `answered(answer)` for a kept answer in the wire's `settle`; the kept copy reads synced.
test('an answer the worker kept is not synced until the network answers — 16.85', async () => {
    const getNote = wire('GET', '/rpc/getNote') as Caller
    let kept = true
    answers.set('/rpc/getNote', () =>
        Response.json(
            { from: kept ? 'kept' : 'server' },
            kept
                ? { headers: { 'abide-kept': 'Mon, 26 Oct 2026 09:40:00 GMT' } }
                : {},
        ),
    )
    const note = getNote({ id: '3' })
    expect(await note).toEqual({ from: 'kept' })
    expect(note.synced()).toBe(false)
    kept = false
    await settle(30)
    expect(note()).toEqual({ from: 'server' })
    expect(note.synced()).toBe(true)
})

// 16.82, 46.7, 46.10 — A MUTATION WITH NO ANSWER IS QUEUED, settles to its stand-in, and is sent again
// under the key it was first sent with; delivered, it leaves the line and its value takes the
// server's answer. THE REVERT: drop the `enqueue` from the wire's `stoodIn`; the call is never sent
// again and `outbox()` stays empty.
test('a mutation with no answer is queued, sent again under its key, and lands its answer — 16.82, 46.7, 46.10', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    network = false
    const added = addNote(
        { text: 'a' },
        { offline: (args) => ({ from: 'device', ...args }) },
    )
    expect(await added).toEqual({ from: 'device', text: 'a' })
    await settle()
    expect(added.synced()).toBe(false)
    expect(outbox().map((call) => call.method)).toEqual(['POST'])
    network = true
    await delivered()
    expect(added()).toEqual({ from: 'server', path: '/rpc/addNote' })
    expect(added.synced()).toBe(true)
    expect(outbox()).toEqual([])
    const keys = sent
        .filter((send) => send.path === '/rpc/addNote')
        .map((send) => send.key)
    expect(keys.length).toBe(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0] as string)
})

// 16.83, 46.3 — BEHIND A CALL WAITING, A CALL WAITS ITS TURN: it is not sent past it, and the line goes
// out oldest first. THE REVERT: drop the `undelivered()` test from the wire's body; the second call
// is sent at once, ahead of the first.
test('a call queued behind another is not sent ahead of it — 16.83, 46.3', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    const offline = { offline: () => ({ from: 'device' }) }
    network = false
    await addNote({ text: 'first' }, offline)
    await settle()
    network = true
    sent.length = 0
    await addNote({ text: 'second' }, offline)
    await settle()
    expect(sent.filter((send) => send.path === '/rpc/addNote')).toEqual([])
    expect(outbox().map((call) => call.args?.text)).toEqual(['first', 'second'])
    await delivered()
    expect(sent.filter((send) => send.path === '/rpc/addNote').length).toBe(2)
    expect(outbox()).toEqual([])
})

// 46.5 — A REFUSED CALL STAYS, SAYING WHY, AND THE LINE GOES ON: the server answered, so nothing after
// it is waiting on it. THE REVERT: `return` in place of `continue` after a refusal in `sendLine`; the
// second call is never sent.
test('a refused call stays with its error and does not hold back the next — 46.5', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    const tagNote = wire('POST', '/rpc/tagNote') as Caller
    const offline = { offline: () => ({ from: 'device' }) }
    network = false
    const refusedCall = addNote({ text: 'bad' }, offline)
    await refusedCall
    await settle()
    await tagNote({ tag: 'x' }, offline)
    await settle()
    network = true
    answers.set(
        '/rpc/addNote',
        () =>
            new Response(
                JSON.stringify({
                    type: 'Invalid',
                    title: 'Invalid',
                    status: 422,
                    detail: 'text is wrong',
                }),
                {
                    status: 422,
                    headers: { 'content-type': 'application/problem+json' },
                },
            ),
    )
    await delivered()
    const calls = outbox()
    expect(
        calls.map((call) => `${call.url} ${call.value.error()?.name}`),
    ).toEqual(['/rpc/addNote Invalid'])
    expect((refusedCall.error() as { name: string }).name).toBe('Invalid')
    // Queued behind the first (16.83), so sent once: as the line reached it.
    expect(sent.filter((send) => send.path === '/rpc/tagNote').length).toBe(1)
})

// 46.6, 46.12 — A CALL REFUSED 401 HOLDS THE LINE until whoever is signed in changes or the app asks
// again: what follows it was made by the same caller. THE REVERT: drop the `held = true` in
// `sendLine`; the second call is sent while the first stands refused.
test('a call refused 401 holds the line until retry — 46.6, 46.12', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    const offline = { offline: () => ({ from: 'device' }) }
    network = false
    await addNote({ text: 'one' }, offline)
    await settle()
    await addNote({ text: 'two' }, offline)
    await settle()
    network = true
    let signedIn = false
    answers.set('/rpc/addNote', () =>
        signedIn
            ? Response.json({ ok: true })
            : new Response(null, { status: 401 }),
    )
    sent.length = 0
    const adds = (): number =>
        sent.filter((send) => send.path === '/rpc/addNote').length
    await delivered()
    expect(adds()).toBe(1)
    // The next reason to send — the network back, the page in view — sends nothing past it.
    await delivered()
    expect(adds()).toBe(1)
    signedIn = true
    for (const call of outbox(addNote as never)) call.retry()
    await settle(30)
    expect(adds()).toBe(3)
    expect(outbox()).toEqual([])
})

// 46.13 — A CALL CAN BE LET GO, and only that one. THE REVERT: keep every call in `discard`; the line
// still holds two.
test("a call's discard drops it alone — 46.13", async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    const offline = { offline: () => ({ from: 'device' }) }
    network = false
    await addNote({ text: 'one' }, offline)
    await settle()
    await addNote({ text: 'two' }, offline)
    await settle()
    const [first] = outbox()
    first?.discard()
    await settle()
    expect(outbox().map((call) => call.args?.text)).toEqual(['two'])
})

// 46.11 — A QUEUED CALL SENT IS WORK IN FLIGHT FOR ITS HANDLER, as a call made now is: `busy` over the
// handler, and a bare `busy`, say so until it lands. THE REVERT: drop `sendingFor` from the handler's
// `busy` in `declare`; `busy(addNote)` reads false while its call is in flight.
test('busy is true over a handler while the outbox sends its call — 46.11', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    network = false
    await addNote({ text: 'one' }, { offline: () => ({ from: 'device' }) })
    await settle()
    network = true
    let release = (): void => {}
    answers.set('/rpc/addNote', () => Response.json({ ok: true }))
    const unstubbed = globalThis.fetch
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        if (new URL(input, 'http://app.test').pathname === '/rpc/addNote')
            await new Promise<void>((done) => {
                release = done
            })
        return unstubbed(input, init)
    }) as unknown as typeof fetch
    try {
        deliver()
        await settle()
        expect(busy(addNote as never)).toBe(true)
        expect(busy()).toBe(true)
        release()
        await settle(30)
        expect(busy(addNote as never)).toBe(false)
    } finally {
        globalThis.fetch = unstubbed
    }
})

// 46.1, 46.16 — `outbox` IS ASKED OF A SELECTION AS A PROBE IS: every call, one handler's, one
// handler's narrowed by its args, and none for a selection naming no handler. THE REVERT: return the
// whole line from `outbox` whatever it is handed; `outbox(tagNote as never)` reads both calls.
test('outbox answers the calls a selection names — 46.1, 46.16', async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller & {
        outbox(pattern?: Record<string, unknown>): { args: unknown }[]
    }
    const tagNote = wire('POST', '/rpc/tagNote') as Caller
    const offline = { offline: () => ({ from: 'device' }) }
    network = false
    await addNote({ text: 'a' }, offline)
    await settle()
    await tagNote({ tag: 'x' }, offline)
    await settle()
    expect(outbox().length).toBe(2)
    expect(outbox(tagNote as never).map((call) => call.args)).toEqual([
        { tag: 'x' },
    ])
    expect(addNote.outbox({ text: 'a' }).length).toBe(1)
    expect(addNote.outbox({ text: 'b' }).length).toBe(0)
    const { reactive } = await import('#shared')
    expect(outbox(reactive(0))).toEqual([])
})

// 46.17 — READING `outbox` SUBSCRIBES, as a probe does: a badge counting the calls waiting is told
// when one is queued and when it is delivered. THE REVERT: read the line with `LINE.peek()` in
// `outbox`; the count is read once, as 0, and never again.
test('a reader of outbox is woken as calls are queued and delivered — 46.17', async () => {
    const { flushSync, watch } = await import('#shared')
    const addNote = wire('POST', '/rpc/addNote') as Caller
    const counted: number[] = []
    const stop = watch(() => {
        counted.push(outbox().length)
    })
    network = false
    await addNote({ text: 'a' }, { offline: () => ({ from: 'device' }) })
    await settle()
    flushSync()
    network = true
    await delivered()
    flushSync()
    stop()
    // The line is shown again as each send starts, so a count can repeat: what matters is it moved.
    const moves = counted.filter((count, at) => count !== counted[at - 1])
    expect(moves).toEqual([0, 1, 0])
})

// 46.18, 46.12 — A QUEUED CALL CARRIES THE VALUE ITS CALL SETTLED: the very one the page holds, its
// stand-in until the server answers, and its refusal as `error()`; a retry takes the refusal off, and
// the value is waiting again rather than refused. THE REVERT: drop the `value.set` in `retry`; the
// retried call still reads `Invalid` while it is waiting.
test("a queued call carries its call's value, refused and retried — 46.18, 46.12", async () => {
    const addNote = wire('POST', '/rpc/addNote') as Caller
    network = false
    const added = addNote(
        { text: 'a' },
        { offline: () => ({ from: 'device' }) },
    )
    await added
    await settle()
    const queued = outbox()[0]
    if (queued === undefined) throw new Error('nothing was queued')
    expect(queued.value).toBe(added as unknown as typeof queued.value)
    expect(queued.value.synced()).toBe(false)
    network = true
    answers.set(
        '/rpc/addNote',
        () =>
            new Response(
                JSON.stringify({
                    type: 'Invalid',
                    status: 422,
                    title: 'Invalid',
                }),
                {
                    status: 422,
                    headers: { 'content-type': 'application/problem+json' },
                },
            ),
    )
    await delivered()
    expect(queued.value.error()?.name).toBe('Invalid')
    network = false
    queued.retry()
    await settle(30)
    expect(queued.value.error()).toBeUndefined()
    expect(queued.value()).toEqual({ from: 'device' })
    expect(queued.value.synced()).toBe(false)
})

// 18.35 — A COPY WRITTEN HERE READS AGAIN ONCE THE LINE IS DELIVERED, though the server sent it nothing
// while the line waited: what a call's `offline` patched into another `GET`'s copy is the device's
// guess, and the server's value has the call in it now. THE REVERT: drop the `whenDelivered` in
// `muxFor`; the list keeps the device's note and stays unsynced.
test('a GET copy another call patched offline reads again once the line is delivered — 18.35', async () => {
    const listNotes = wire('GET', '/rpc/listNotes') as Caller
    const addNote = wire('POST', '/rpc/addNote') as Caller
    // Alive for a minute, so nothing but the delivered line has it read again.
    let from = 'server'
    answers.set('/rpc/listNotes', () =>
        Response.json(
            { from, path: '/rpc/listNotes' },
            { headers: { 'cache-control': 'private, max-age=60' } },
        ),
    )
    const notes = listNotes({}) as Call & {
        patch(mutate: (held: { from: string }) => void): void
    }
    await notes
    network = false
    await addNote(
        { text: 'b' },
        {
            offline: (args) => {
                notes.patch((held) => {
                    held.from = 'device'
                })
                return args
            },
        },
    )
    await settle()
    expect(notes()).toEqual({ from: 'device', path: '/rpc/listNotes' })
    expect(notes.synced()).toBe(false)
    from = 'server, with the call'
    network = true
    await delivered()
    await settle()
    expect(outbox()).toEqual([])
    expect(notes()).toEqual({
        from: 'server, with the call',
        path: '/rpc/listNotes',
    })
    expect(notes.synced()).toBe(true)
})
