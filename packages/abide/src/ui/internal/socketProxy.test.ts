// CLIENT SOCKET PROXY (client-sockets.md CS3/CS4) — the browser `Socket` proxy over the shared mux.
// Driven with a fake browser env + fake WebSocket (no real network): assert the subscribe-on-active-
// read, the sub-ack/sub-error/data control frames driving the reactive probe state machine, fan-out to
// `{#for await}` iterators, and the `clientPublish` publish gate. Globals + the mux singleton are reset
// (a terminal 1008 close clears the mux) after each test.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { makeClientSocketImports, type SocketSpec } from './socketProxy.ts'

interface SocketLike {
    publish(message: unknown): void
    peek(): unknown
    chunks(): unknown[]
    pending(): boolean
    refreshing(): boolean
    done(): boolean
    error(): unknown
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
    const full: SocketSpec = { clientPublish: false, tail: 0, ttl: null, ...spec }
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
    expect(chat.peek()).toBe('hello')
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
    expect(chat.peek()).toBe(3)
})

test('publish gating: clientPublish:false throws; true sends a pub frame', () => {
    const closed = makeProxy({ clientPublish: false })
    expect(() => closed.publish('x')).toThrow(/client publish is disabled/)

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
