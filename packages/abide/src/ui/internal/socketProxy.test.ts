// CLIENT SOCKET PROXY (client-sockets.md CS3/CS4) — the browser `Socket` proxy over the shared mux.
// Driven with a fake browser env + fake WebSocket (no real network): assert the subscribe-on-active-
// read, the sub-ack/sub-error/data control frames driving the reactive probe state machine, fan-out to
// `{#for await}` iterators, and the `clientPublish` publish gate. Globals + the mux singleton are reset
// (a terminal 1008 close clears the mux) after each test.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { clearSocketProxyCache, makeClientSocketImports, type SocketSpec } from './socketProxy.ts'

// A structurally FAITHFUL shim for the erased proxy. The probes take an optional key because
// `ErasedSocketSurface` is `SocketSurface<unknown, unknown>` — `Args` is `unknown`, not `void`, so the
// real surface's probes carry a parameter even though a single-topic socket calls them bare. Declaring
// them zero-arg made the cast below stop overlapping. Worth keeping faithful rather than widening the
// cast: a shim that has drifted from the surface it stands in for is how a proxy silently ends up
// missing a member, which is the whole reason `SocketSurfaceMembers` is `Omit`-derived.
interface SocketLike {
    publish(message: unknown): void
    live(args?: unknown): unknown
    chunks(args?: unknown): unknown[]
    pending(args?: unknown): boolean
    refreshing(args?: unknown): boolean
    done(args?: unknown): boolean
    error(args?: unknown): unknown
    [Symbol.asyncIterator](): AsyncIterator<unknown>
}

const instances: FakeWebSocket[] = []

class FakeWebSocket {
    readyState = 1 // already OPEN so `send` fires synchronously on subscribe
    url: string
    sent: string[] = []
    private listeners: Record<string, ((event: unknown) => void)[]> = {}
    constructor(url: string) {
        this.url = url
        instances.push(this)
    }
    addEventListener(type: string, fn: (event: unknown) => void): void {
        const list = this.listeners[type] ?? []
        this.listeners[type] = list
        list.push(fn)
        if (type === 'open') fn({}) // synchronous open — flush subscribe/publish frames now
    }
    send(data: string): void {
        this.sent.push(data)
    }
    close(): void {}
    emit(type: string, event: unknown): void {
        for (const fn of this.listeners[type] ?? []) fn(event)
    }
    inbound(frame: unknown): void {
        this.emit('message', { data: JSON.stringify(frame) })
    }
}

// Captured ONCE per test in beforeEach — NEVER inside `makeProxy`, so a test that builds two proxies
// can't capture the fake WebSocket (installed by the first) as the "original" and leak it into the
// real-WS tests in other files.
const saved: Record<string, unknown> = {}

beforeEach(() => {
    // The proxy cache is module state (one proxy per `(base, name)` for the tab's life), so every test
    // that expects to build a FRESH proxy — and to see it open a fresh mux subscription — has to drop it.
    // The sibling of `clearClientProxyCache` in the RPC proxy's tests.
    clearSocketProxyCache()
    const g = globalThis as Record<string, unknown>
    saved.window = g.window
    saved.WebSocket = g.WebSocket
    saved.location = g.location
    saved.had = 'window' in g
    g.window = {}
    g.WebSocket = FakeWebSocket as unknown
    g.location = { protocol: 'https:', host: 'app.test' }
})

afterEach(() => {
    // Terminal close (1008) clears the mux's subscriptions + socket so the next test starts clean.
    for (const ws of instances) ws.emit('close', { code: 1008 })
    instances.length = 0
    const g = globalThis as Record<string, unknown>
    if (saved.had === true) g.window = saved.window
    else delete g.window
    g.WebSocket = saved.WebSocket
    g.location = saved.location
})

function makeProxy(spec: Partial<SocketSpec> = {}): SocketLike {
    const full: SocketSpec = { clientPublish: false, tail: 0, maxAge: null, ...spec }
    const imports = makeClientSocketImports({ chat: full })
    return imports.chat as SocketLike
}

function lastWs(): FakeWebSocket {
    const ws = instances.at(-1)
    if (ws === undefined) throw new Error('no fake socket was opened')
    return ws
}

test('an active read (iterate) opens ONE subscribe frame; status starts pending', () => {
    const chat = makeProxy()
    expect(chat.done()).toBe(true) // idle before any active read
    const iterator = chat[Symbol.asyncIterator]()
    const frames = lastWs().sent.map((raw) => JSON.parse(raw))
    expect(frames).toEqual([{ t: 'sub', name: 'chat', args: undefined }])
    expect(chat.pending()).toBe(true)
    expect(chat.done()).toBe(false)
    void iterator.return?.()
})

test('sub-ack clears pending() → live; a data frame drives peek/chunks and the iterator', async () => {
    const chat = makeProxy({ tail: 5 })
    const iterator = chat[Symbol.asyncIterator]()
    const ws = lastWs()

    ws.inbound({ name: 'chat', ok: true })
    expect(chat.pending()).toBe(false)

    ws.inbound({ name: 'chat', msg: 'hello' })
    expect(chat.live()).toBe('hello')
    expect(chat.chunks()).toEqual(['hello'])

    const first = await iterator.next()
    expect(first).toEqual({ value: 'hello', done: false })
    void iterator.return?.()
})

test('chunks() is capped at tail size (drop-oldest)', () => {
    const chat = makeProxy({ tail: 2 })
    chat.chunks() // active read → subscribe
    const ws = lastWs()
    ws.inbound({ name: 'chat', msg: 1 })
    ws.inbound({ name: 'chat', msg: 2 })
    ws.inbound({ name: 'chat', msg: 3 })
    expect(chat.chunks()).toEqual([2, 3])
    expect(chat.live()).toBe(3)
})

// ADR 0023 measured and rejected fusing the replay `tail` with the per-cursor delivery FIFO, and the
// proxy did it anyway (`cap = spec.tail > 0 ? spec.tail : 1024`, used for BOTH). The server never has:
// `ChannelHub.subscribe` gives every cursor the default FIFO regardless of `tail`. So a small-tail
// socket dropped a burst in the browser and delivered it in full on the server — the exact `tail:4` /
// burst-10 case ADR 0023 records as `[7,8,9,10]` vs `1..10`.
test('a small tail bounds chunks() but NOT a parked cursor — the two are separate capacities', async () => {
    const chat = makeProxy({ tail: 4 })
    const iterator = chat[Symbol.asyncIterator]()
    const ws = lastWs()
    ws.inbound({ name: 'chat', ok: true })

    // A burst larger than `tail`, delivered while the cursor is parked (nothing has pulled yet).
    for (let n = 1; n <= 10; n++) ws.inbound({ name: 'chat', msg: n })

    // Retention IS bounded by tail — that is what `tail` means.
    expect(chat.chunks()).toEqual([7, 8, 9, 10])

    // Delivery is NOT. The parked cursor still owes every message, as it does on the server.
    const received: unknown[] = []
    for (let n = 1; n <= 10; n++) received.push((await iterator.next()).value)
    expect(received).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    void iterator.return?.()
})

// A `tail: 0` socket retains nothing to replay — `peek()` is still sticky (CS4.2, the hub keeps `last`
// independent of the ring). The proxy used to fall back to a 1024-deep `chunks()` here, which the
// server never offered.
test('tail: 0 retains no transcript, but peek() stays sticky', () => {
    const chat = makeProxy({ tail: 0 })
    chat.chunks()
    const ws = lastWs()
    ws.inbound({ name: 'chat', msg: 'a' })
    ws.inbound({ name: 'chat', msg: 'b' })
    expect(chat.chunks()).toEqual([])
    expect(chat.live()).toBe('b')
})

test('publish gating: clientPublish:false throws; true sends a pub frame', () => {
    const closed = makeProxy({ clientPublish: false })
    expect(() => closed.publish('x')).toThrow(/client publish is disabled/)

    // Two DIFFERENT specs under one socket name is a test-only situation: the proxy cache keys on
    // `(base, name)`, so a second `makeClientSocketImports` for `chat` hands back the first proxy —
    // which is the point of it, since in a real tab the spec for a name is fixed by the build.
    clearSocketProxyCache()
    const open = makeProxy({ clientPublish: true })
    open.publish('hi')
    const frames = lastWs().sent.map((raw) => JSON.parse(raw))
    expect(frames).toContainEqual({ t: 'pub', name: 'chat', msg: 'hi' })
})

test('a sub-error frame sets terminal error() and ends the iterators', async () => {
    const chat = makeProxy()
    const iterator = chat[Symbol.asyncIterator]()
    lastWs().inbound({ name: 'chat', error: { message: 'unknown socket: chat' } })
    expect(chat.error()).toEqual({ message: 'unknown socket: chat' })
    expect(chat.pending()).toBe(false)
    const done = await iterator.next()
    expect(done.done).toBe(true)
})

// A roomed socket is the SAME proxy, called with a room key. `sock({room})` iterates that room;
// `sock.live({room})` / `sock.publish({room}, msg)` address it.
interface RoomedSocketLike {
    (room: unknown): AsyncIterable<unknown>
    live(room?: unknown): unknown
    publish(room: unknown, message: unknown): void
}

function roomedProxy(spec: Partial<SocketSpec> = {}): RoomedSocketLike {
    const full: SocketSpec = { clientPublish: true, tail: 5, maxAge: null, ...spec }
    return makeClientSocketImports({ feed: full }).feed as RoomedSocketLike
}

test('rooms: subscribing a room sends args; a frame routes ONLY to its room', async () => {
    const feed = roomedProxy()
    const a = feed({ room: 'a' })[Symbol.asyncIterator]()
    const b = feed({ room: 'b' })[Symbol.asyncIterator]()
    const ws = lastWs()

    // Two distinct subscribe frames, each carrying its room.
    const subs = ws.sent.map((raw) => JSON.parse(raw)).filter((f) => f.t === 'sub')
    expect(subs).toEqual([
        { t: 'sub', name: 'feed', args: { room: 'a' } },
        { t: 'sub', name: 'feed', args: { room: 'b' } },
    ])

    // A room-a data frame reaches a, never b.
    ws.inbound({ name: 'feed', args: { room: 'a' }, msg: 'to-a' })
    expect(feed.live({ room: 'a' })).toBe('to-a')
    expect(feed.live({ room: 'b' })).toBeUndefined()
    expect(await a.next()).toEqual({ value: 'to-a', done: false })

    void a.return?.()
    void b.return?.()
})

test('rooms: publish carries the room args on the pub frame', () => {
    const feed = roomedProxy({ clientPublish: true })
    feed.publish({ room: 'a' }, 'hi-a')
    const frames = lastWs().sent.map((raw) => JSON.parse(raw))
    expect(frames).toContainEqual({ t: 'pub', name: 'feed', args: { room: 'a' }, msg: 'hi-a' })
})

test('two iterators of the same socket share ONE mux subscription (local fan-out)', () => {
    const chat = makeProxy()
    const a = chat[Symbol.asyncIterator]()
    const b = chat[Symbol.asyncIterator]()
    // Only one subscribe frame despite two cursors (CS3.1 refcounted single sub per name).
    const subs = lastWs()
        .sent.map((raw) => JSON.parse(raw))
        .filter((f) => f.t === 'sub')
    expect(subs.length).toBe(1)
    void a.return?.()
    void b.return?.()
})
