// PR5 — CLIENT auto-subscribe + apply for the server SHARED cache broadcast (shared-cache-plan
// §2.5). Three layers of coverage:
//   1. applyMemoFrame — the focused "given an inbound MemoFrame, drive the right local memo verb
//      with the right args" unit (this IS the handler the client proxy registers on the mux).
//   2. clientProxy auto-subscribe — a `crossRequest` read joins its `@rpc:` channel with the RAW args,
//      dedups per args, and a per-request read never subscribes (fake WS, no real network/server).
//   3. End-to-end delivery — the real router broadcasts a `crossRequest` publish to an AUTHORIZED WS
//      subscriber (the same frame protocol the mux speaks); the frame drives applyMemoFrame into a
//      real client memo, mirroring the server value locally.

import { afterEach, expect, test } from 'bun:test'
import { GET } from '../../server/GET.ts'
import type { Rpc } from '../../server/internal/makeRpc.ts'
import { memoChannelName } from '../../shared/internal/memoChannelName.ts'
import type { MemoFrame } from '../../shared/internal/memoChannels.ts'
import { memoChannelHub } from '../../shared/internal/memoChannels.ts'
import { applyTagFrame, clearTagRegistry } from '../../shared/internal/memoTags.ts'
import { tagChannelName } from '../../shared/internal/tagChannelName.ts'
import { invalidate } from '../../shared/invalidate.ts'
import { memo } from '../../shared/memo.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { applyMemoFrame } from './applyMemoFrame.ts'
import { clientProxy } from './clientProxy.ts'
import { subscribeMemoChannel } from './mux.ts'

let running: TestApp | undefined
afterEach(async () => {
    await running?.stop()
    running = undefined
})

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// 1. applyMemoFrame — frame → local verb mapping
// ---------------------------------------------------------------------------

test('applyMemoFrame drives the matching local memo verb with the subscribed args', () => {
    let calls = 0
    const c = memo<{ id: string }, string>(async ({ id }) => `load-${id}#${++calls}`)

    // publish value-form → the local value reflects the broadcast value for THOSE args.
    c.seed({ id: 'A' }, 'seed-A')
    applyMemoFrame(c, { id: 'A' }, { verb: 'publish', value: 'broadcast-A' })
    expect(c.live({ id: 'A' })).toBe('broadcast-A')

    // invalidate → the slot drops to idle (lazy reload on next read), value cleared.
    applyMemoFrame(c, { id: 'A' }, { verb: 'invalidate' })
    expect(c.live({ id: 'A' })).toBeUndefined()

    // refresh → eager revalidation on the retained slot (re-runs the loader).
    c.seed({ id: 'B' }, 'seed-B')
    applyMemoFrame(c, { id: 'B' }, { verb: 'refresh' })
    expect(c.refreshing({ id: 'B' })).toBe(true)
})

// ---------------------------------------------------------------------------
// 2. subscribeMemoChannel is a hard no-op under SSR (no window / WebSocket)
// ---------------------------------------------------------------------------

test('subscribeMemoChannel is a no-op under SSR (no window)', () => {
    // The bun test process has `window` deleted (happy-dom preload), i.e. the SSR condition. The mux
    // must not throw and must not construct a socket.
    expect(typeof window).toBe('undefined')
    let applied = false
    expect(() =>
        subscribeMemoChannel('@rpc:x:key', { id: 'A' }, () => (applied = true)),
    ).not.toThrow()
    expect(applied).toBe(false)
})

// ---------------------------------------------------------------------------
// 3. clientProxy auto-subscribe: crossRequest joins (raw args + dedup); per-request never subscribes.
//    Fully synchronous with a fake browser env + fake WebSocket + stubbed fetch — NO real network
//    and NO server runs while `window` is set, so the shared-process side-detection is never
//    exercised by server code. Globals restored (and the mux socket reset) before the test returns.
// ---------------------------------------------------------------------------

test('crossRequest read subscribes to its @rpc channel (raw args, dedup); per-request does not', () => {
    const sent: string[] = []
    const closers: (() => void)[] = []
    class FakeWebSocket {
        readyState = 1 // pretend already OPEN so `send` fires synchronously on subscribe
        constructor(public url: string) {}
        addEventListener(type: string, fn: (event: unknown) => void): void {
            if (type === 'open') fn({})
            if (type === 'close') closers.push(() => fn({}))
        }
        send(data: string): void {
            sent.push(data)
        }
        close(): void {}
    }

    const g = globalThis as Record<string, unknown>
    const saved = { window: g.window, WebSocket: g.WebSocket, location: g.location, fetch: g.fetch }
    const hadWindow = 'window' in g
    g.window = {}
    g.WebSocket = FakeWebSocket as unknown
    g.location = { protocol: 'https:', host: 'app.test' }
    g.fetch = (): Promise<Response> =>
        Promise.resolve(
            new Response(JSON.stringify({ ok: 1 }), {
                headers: { 'content-type': 'application/json' },
            }),
        )

    try {
        const crossRequest = clientProxy<{ id: string }, unknown>('prof', 'GET', {
            crossRequest: true,
        }) as Rpc<{ id: string }, unknown>
        const plain = clientProxy<{ id: string }, unknown>('plain', 'GET', {
            crossRequest: false,
        }) as Rpc<{ id: string }, unknown>

        // Reactive reads: ensureSubscribe fires synchronously (before the async fetch settles).
        crossRequest({ id: 'A' }) // crossRequest → subscribe channel A
        crossRequest({ id: 'A' }) // same args → dedup, no second subscribe
        crossRequest({ id: 'B' }) // different args → subscribe channel B
        plain({ id: 'A' }) // per-request → never subscribes

        const frames = sent.map(
            (raw) => JSON.parse(raw) as { t: string; name: string; args: unknown },
        )
        // Exactly two subscribes (A once + B once); the duplicate A and the per-request read added none.
        expect(frames.length).toBe(2)
        expect(frames[0]).toEqual({
            t: 'sub',
            name: memoChannelName('prof', { id: 'A' }),
            args: { id: 'A' },
        })
        expect(frames[1]).toEqual({
            t: 'sub',
            name: memoChannelName('prof', { id: 'B' }),
            args: { id: 'B' },
        })
        // Never an @rpc:plain channel — a per-request read does not subscribe.
        expect(frames.some((frame) => frame.name.startsWith('@rpc:plain:'))).toBe(false)
    } finally {
        for (const close of closers) close() // reset the mux socket singleton (fires its close listener)
        if (hadWindow) g.window = saved.window
        else delete g.window
        g.WebSocket = saved.WebSocket
        g.location = saved.location
        g.fetch = saved.fetch
    }
})

// ---------------------------------------------------------------------------
// 4. End-to-end: real server broadcast → authorized WS subscriber → applyMemoFrame mirrors locally.
// ---------------------------------------------------------------------------

test('server crossRequest-publish broadcast reaches an authorized subscriber and applies to a local memo', async () => {
    const prof = GET(({ id }: { id: string }) => ({ id, secret: `secret-${id}` }), {
        memo: { crossRequest: true },
    })
    running = await createTestApp({ routes: { prof: prof } })

    const args = { id: 'A' }
    const socket = running.socket()
    const stream = socket.subscribe<MemoFrame>(memoChannelName('prof', args), args)
    await socket.ready()
    await delay(80) // let the async authorize+join complete before publishing

    const value = { id: 'A', secret: 'published' }
    ;(prof as Rpc<{ id: string }, { id: string; secret: string }>).publish(args, value)

    const iterator = stream[Symbol.asyncIterator]()
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000))
    const frame = await Promise.race([iterator.next().then((r) => r.value), timeout])
    expect(frame).toEqual({ verb: 'publish', value })

    // Drive the received frame into a fresh client memo — its local value mirrors the server broadcast.
    const clientMemo = memo<{ id: string }, { id: string; secret: string }>(async () => ({
        id: 'A',
        secret: 'stale',
    }))
    clientMemo.seed(args, { id: 'A', secret: 'stale' })
    applyMemoFrame(clientMemo, args, frame as MemoFrame)
    expect(clientMemo.live(args)).toEqual(value)

    socket.close()
})

// 4. `@tag:` channel — the tag-level broadcast that reaches a browser for a read that is NOT
//    crossRequest. Its `@rpc:` channel is per-(rpc,args) and only a crossRequest route has one, so a
//    plain tagged read had no way to hear a server-side refresh/invalidate({tags}) before this.
test('a server invalidate({ tags }) reaches a subscriber on the @tag: channel', async () => {
    const widgets = GET(() => ({ ok: true }), { memo: { tags: ['widgets'] } })
    running = await createTestApp({ routes: { widgets } })

    const socket = running.socket()
    const stream = socket.subscribe<MemoFrame>(tagChannelName('widgets'))
    await socket.ready()
    await delay(80) // let the join complete before publishing

    invalidate({ tags: ['widgets'] })

    const iterator = stream[Symbol.asyncIterator]()
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000))
    const frame = await Promise.race([iterator.next().then((r) => r.value), timeout])
    expect(frame).toEqual({ verb: 'invalidate' })

    socket.close()
    clearTagRegistry()
})

// The declaration gate (`authorizeTagJoin`): a tag no browser-reachable read declares is not joinable,
// so a client cannot fish for the existence or the change-timing of a server-internal tag. Silent-deny,
// same class as an `@rpc:` refusal — the client learns nothing about why.
test('a tag no browser-reachable read declares is not joinable', async () => {
    const widgets = GET(() => ({ ok: true }), { memo: { tags: ['widgets'] } })
    const internal = GET(() => ({ ok: true }), {
        memo: { tags: ['internal'] },
        clients: { browser: false },
    })
    running = await createTestApp({ routes: { widgets, internal } })

    const socket = running.socket()
    const stream = socket.subscribe<MemoFrame>(tagChannelName('internal'))
    await socket.ready()
    await delay(80)

    invalidate({ tags: ['internal'] })

    const iterator = stream[Symbol.asyncIterator]()
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 300))
    const frame = await Promise.race([iterator.next().then((r) => r.value), timeout])
    expect(frame).toBe('timeout') // denied — no frame ever arrives

    socket.close()
    clearTagRegistry()
})

// The inbound half: a received frame drives every LOCAL memo carrying the tag, and does NOT echo back
// onto the channel (which is why it is `applyTagFrame` and not `invalidateTags`).
test('applyTagFrame drives local memos carrying the tag without re-publishing', async () => {
    let calls = 0
    const tagged = memo(
        async () => {
            calls++
            return calls
        },
        { tags: ['local'] },
    )
    expect(await tagged()).toBe(1)

    const hub = memoChannelHub(tagChannelName('local'))
    const echo = hub.subscribe()

    applyTagFrame('local', 'invalidate')
    expect(await tagged()).toBe(2) // the local memo re-ran

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100))
    const echoed = await Promise.race([echo.next().then((r) => r.value), timeout])
    expect(echoed).toBe('timeout') // no frame was published back onto the tag channel

    clearTagRegistry()
})
