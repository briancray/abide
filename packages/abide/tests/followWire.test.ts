// 18.17, 18.24, 18.25 — A `GET` FOLLOWED FROM THE BROWSER'S SIDE. The mux is driven through a stand-in
// `WebSocket` whose frames the test reads and writes, and `fetch` answers from here, so what is
// asserted is what the wire sends and what the copy does with what it is sent.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { flushSync } from '#shared'
import { wire } from '#ui/wire.ts'

type Sent = {
    op: string
    id: number
    address: string
    args?: unknown
    version?: number
}

// AN ORIGIN OF THIS FILE'S OWN. The browser's muxes and follows are process-wide, keyed by address
// (`socketWire`), so at the page's own origin this file would be handed a mux an earlier file in
// the same process opened — over its socket, not one of these — and every follow it reads would be
// another file's.
const LIBRARY = 'http://follow-wire.test/__abide/rpc/library'
const MUX = 'ws://follow-wire.test/__abide/socket'

const sockets: FakeSocket[] = []

// The stand-in this file's mux opened last: an earlier file's mux reconnecting under the stub is
// handed one too.
function muxSocket(): FakeSocket {
    return sockets.findLast((socket) => socket.url === MUX) as FakeSocket
}

class FakeSocket {
    static OPEN = 1
    readyState = 0
    sent: Sent[] = []
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    url: string
    constructor(url: string) {
        this.url = url
        sockets.push(this)
        queueMicrotask(() => {
            this.readyState = FakeSocket.OPEN
            this.onopen?.()
        })
    }
    send(text: string): void {
        this.sent.push(JSON.parse(text))
    }
    // A frame from the server.
    push(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) })
    }
}

const unstubbedSocket = globalThis.WebSocket
const unstubbedFetch = globalThis.fetch
let shelf: string[] = ['dune']
let answers = 0
let answeredVersion = 0

beforeAll(() => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    globalThis.fetch = (async () => {
        answers += 1
        answeredVersion = 100 + answers
        return new Response(JSON.stringify(shelf), {
            headers: {
                'content-type': 'application/json',
                'abide-version': String(answeredVersion),
            },
        })
    }) as unknown as typeof fetch
})

afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
    globalThis.fetch = unstubbedFetch
})

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 10))

// 18.24 — THE FOLLOW NAMES THE VERSION ITS ANSWER CARRIED, and 18.25 — a value the server sends is the
// copy's. THE REVERT: skip `followRpc` in `wire`'s settle; nothing is sent over the mux and the copy
// keeps ['dune'] where ['dune', 'emma'] is due.
test('a GET loaded is followed at the version it was answered with, and takes what it is sent', async () => {
    const books = wire('GET', `${LIBRARY}/books`) as (
        args?: unknown,
    ) => (() => string[]) & PromiseLike<string[]>
    expect(await books()).toEqual(['dune'])
    await settle()

    const socket = muxSocket()
    expect(socket?.url).toBe(MUX)
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/books`,
    ) as Sent
    expect(follow.op).toBe('sub')
    expect(follow.version).toBe(answeredVersion)

    socket.push({
        op: 'value',
        id: follow.id,
        version: answeredVersion + 1,
        value: ['dune', 'emma'],
    })
    flushSync()
    expect(books()()).toEqual(['dune', 'emma'])
})

// 7.10 over the wire — an invalidate the server sent marks the copy stale, and the next read runs its
// producer, which fetches (7.12). THE REVERT: ignore `invalidate` in `Following.receive`; the read is
// answered from what is held and no second fetch is made.
test('an invalidate the server sends makes the next read fetch', async () => {
    const contact = wire('GET', `${LIBRARY}/contact`) as (
        args?: unknown,
    ) => (() => unknown) & PromiseLike<unknown>
    await contact({ id: 7 })
    await settle()
    const socket = muxSocket()
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/contact`,
    ) as Sent
    const before = answers

    shelf = ['a different answer']
    socket.push({ op: 'invalidate', id: follow.id })
    expect(await contact({ id: 7 })).toEqual(['a different answer'])
    expect(answers).toBe(before + 1)
})

// 18.26 — A PATCH WRITTEN OVER THE VERSION THE COPY HOLDS IS APPLIED TO IT, in place: no read, and the
// copy is the same array it was. THE REVERT: publish nothing for a \`patch\` frame in
// \`Following.receive\`; the copy keeps ['dune'].
test('a patch over the version held is written into the copy', async () => {
    shelf = ['dune']
    const shelved = wire('GET', `${LIBRARY}/shelved`) as (
        args?: unknown,
    ) => (() => string[]) & PromiseLike<string[]>
    await shelved()
    await settle()
    const socket = muxSocket()
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/shelved`,
    ) as Sent
    const held = shelved()()
    const before = answers

    socket.push({
        op: 'patch',
        id: follow.id,
        base: follow.version,
        version: (follow.version as number) + 1,
        ops: [
            { path: [0], set: 'dune messiah' },
            { path: [], call: 'push', args: ['emma'] },
        ],
    })
    flushSync()
    expect(shelved()()).toEqual(['dune messiah', 'emma'])
    expect(shelved()()).toBe(held)
    expect(answers).toBe(before)
})

// 18.27 — WRITES MADE OVER ANOTHER VERSION WOULD LAND SOMEWHERE ELSE, so the copy reads again. THE
// REVERT: apply the ops whatever the base; the copy is written over a shelf it never held, and no
// read is made.
test('a patch over a version the copy does not hold makes it read again', async () => {
    shelf = ['dune']
    const archived = wire('GET', `${LIBRARY}/archived`) as (
        args?: unknown,
    ) => (() => string[]) & PromiseLike<string[]>
    await archived()
    await settle()
    const socket = muxSocket()
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/archived`,
    ) as Sent
    const before = answers

    shelf = ['the whole shelf, read again']
    socket.push({
        op: 'patch',
        id: follow.id,
        base: 1,
        version: 2,
        ops: [{ path: [0], set: 'written over the wrong shelf' }],
    })
    await settle()
    expect(answers).toBe(before + 1)
    expect(archived()()).toEqual(['the whole shelf, read again'])
})

// 16.52 THROUGH A FOLLOW: every frame the server sends reaches the follow's entry, and a reach made
// through the `Rpc` is a call with no signal — which pins the load, so the page's abort no longer
// ends it. THE REVERT: have `wire`'s follow reach `rpc(args)` rather than the value; the frame pins
// the reload the page is waiting on, and it is still busy after the page aborts.
test("a frame the follow takes does not keep a page's load going — 16.52", async () => {
    const reading = wire('GET', `${LIBRARY}/reading`) as (
        args?: unknown,
        options?: { signal?: AbortSignal },
    ) => (() => unknown) &
        PromiseLike<unknown> & { refresh(): void; busy(): boolean }
    const value = reading()
    await value
    await settle()
    const socket = muxSocket()
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/reading`,
    ) as Sent

    const answering = globalThis.fetch
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    try {
        value.refresh()
        const leaving = new AbortController()
        reading(undefined, { signal: leaving.signal })
        socket.push({ op: 'error', id: follow.id, error: {} })
        leaving.abort()
        flushSync()
        expect(`busy: ${value.busy()}`).toBe('busy: false')
    } finally {
        globalThis.fetch = answering
    }
})
