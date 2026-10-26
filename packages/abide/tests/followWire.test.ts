// 18.3, 18.9, 18.10 — A `GET` FOLLOWED FROM THE BROWSER'S SIDE. The mux is driven through a stand-in
// `WebSocket` whose frames the test reads and writes, and `fetch` answers from here, so what is
// asserted is what the wire sends and what the copy does with what it is sent.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { flushSync, invalidate, refresh, watch } from '#shared'
import { answerOf } from '#shared/answerOf.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import type { Reactive } from '#shared/reactive/index.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { wire } from '#ui/wire.ts'
import { disarmMuxes } from './disarmMuxes.ts'

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
const LIBRARY = 'http://follow-wire.test/library'
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
    close(): void {
        this.readyState = 3
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
                etag: `"${answeredVersion}"`,
            },
        })
    }) as unknown as typeof fetch
})

// The muxes this file opens are disarmed with it (`disarmMuxes`).
const disarm = disarmMuxes()
afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
    globalThis.fetch = unstubbedFetch
    disarm()
})

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 10))

// 18.9 — THE FOLLOW NAMES THE VERSION ITS ANSWER CARRIED, and 18.10 — a value the server sends is the
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

// 18.11 — A PATCH WRITTEN OVER THE VERSION THE COPY HOLDS IS APPLIED TO IT, in place: no read, and the
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
            { op: 'replace', path: '/0', value: 'dune messiah' },
            { op: 'add', path: '/-', value: 'emma' },
        ],
    })
    flushSync()
    expect(shelved()()).toEqual(['dune messiah', 'emma'])
    expect(shelved()()).toBe(held)
    expect(answers).toBe(before)
})

// 18.12 — WRITES MADE OVER ANOTHER VERSION WOULD LAND SOMEWHERE ELSE, so the copy reads again. THE
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

// 18.21 — A COPY WRITTEN TO HERE IS NOT WHAT THE SERVER'S PATCH WAS WRITTEN OVER, so the copy reads
// again rather than apply it over the local write: a remove by index would take another row. And a
// patch the copy applied itself leaves it in step, so the one after it is applied too. THE REVERT:
// drop `this.diverged(copy)` from `Following.receive`; reads are `[0, 0]` where `[1, 1]` is due, and
// both copies hold the server's remove taken off the local row. Drop the `inStep` after an applied
// patch instead, and the in-step copy reads again on the second patch.
test('a copy written to locally reads again rather than take a patch over it', async () => {
    const followed = async (name: string) => {
        shelf = ['dune', 'emma']
        const copy = wire('GET', `${LIBRARY}/${name}`) as (
            args?: unknown,
        ) => Reactive<string[]> & PromiseLike<string[]>
        await copy()
        await settle()
        const follow = muxSocket().sent.find(
            (frame) => frame.address === `${LIBRARY}/${name}`,
        ) as Sent
        const removeFirst = (base: number) =>
            muxSocket().push({
                op: 'patch',
                id: follow.id,
                base,
                version: base + 1,
                ops: [{ op: 'remove', path: '/0' }],
            })
        return { copy: copy(), follow, removeFirst }
    }
    const reads: number[] = []
    const held: string[][] = []

    // In step: two patches in a row are each applied, and nothing is read.
    const kept = await followed('kept')
    let before = answers
    kept.removeFirst(kept.follow.version as number)
    flushSync()
    kept.removeFirst((kept.follow.version as number) + 1)
    flushSync()
    expect(kept.copy()).toEqual([])
    expect(answers).toBe(before)

    for (const [name, write] of [
        [
            'patchedHere',
            (copy: Reactive<string[]>) =>
                copy.patch((rows) => void rows.unshift('mine')),
        ],
        [
            'setHere',
            (copy: Reactive<string[]>) => copy.set(['mine', 'dune', 'emma']),
        ],
    ] as const) {
        const local = await followed(name)
        write(local.copy)
        before = answers
        shelf = ['dune', 'emma', 'read again']
        local.removeFirst(local.follow.version as number)
        await settle()
        reads.push(answers - before)
        held.push(local.copy())
    }
    expect({ reads, held }).toEqual({
        reads: [1, 1],
        held: [
            ['dune', 'emma', 'read again'],
            ['dune', 'emma', 'read again'],
        ],
    })
})

// 16.48 THROUGH A FOLLOW: every frame the server sends reaches the follow's entry, and a reach made
// through the `Rpc` is a call with no signal — which pins the load, so the page's abort no longer
// ends it. THE REVERT: have `wire`'s follow reach `rpc(args)` rather than the value; the frame pins
// the reload the page is waiting on, and it is still busy after the page aborts.
test("a frame the follow takes does not keep a page's load going — 16.48", async () => {
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

// 13.16 — A SWEEP INVALIDATES A MUTATION'S COPY RATHER THAN RELOADING IT, since the reload is the
// write sent again — even with something reading its answer, which is what 13.7 reloads. THE REVERT:
// drop the \`cell.mutation\` arm from \`refreshOver\`; the bare refresh sends the POST a second time.
test('a bare refresh does not send a mutation again — 13.16', async () => {
    let posts = 0
    const answering = globalThis.fetch
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') posts += 1
        return new Response(JSON.stringify({ saved: posts }), {
            headers: { 'content-type': 'application/json' },
        })
    }) as unknown as typeof fetch
    try {
        const save = wire('POST', `${LIBRARY}/save`) as (
            args?: unknown,
        ) => (() => unknown) & PromiseLike<unknown>
        const saved = save({ title: 'emma' })
        await saved
        const stop = watch(() => {
            try {
                saved()
            } catch {}
        })
        flushSync()
        refresh()
        flushSync()
        await settle()
        stop()
        expect(`posts: ${posts}`).toBe('posts: 1')
    } finally {
        globalThis.fetch = answering
    }
})

// 13.17 — A MUTATION IN FLIGHT IS LEFT TO LAND by a sweep: marked, its answer lands nowhere and the
// caller awaiting it is never told. THE REVERT: drop the `cell.loading` guard from `invalidateIn`; the
// await below reads 'hung'.
test('a bare refresh during a mutation leaves its answer to land — 13.17', async () => {
    // EVERY REQUEST THE REFRESH STARTS IS ANSWERED, not the last one: a bare refresh reaches every
    // global value in the process (13.10), an earlier file's among them, and a stub holding one
    // resolver answered that file's reload and left the write hanging.
    const answers: ((response: Response) => void)[] = []
    const answer = (response: Response): void => {
        for (const resolve of answers.splice(0)) resolve(response.clone())
    }
    const answering = globalThis.fetch
    globalThis.fetch = (() =>
        new Promise<Response>((resolve) => {
            answers.push(resolve)
        })) as unknown as typeof fetch
    try {
        const save = wire('POST', `${LIBRARY}/save`) as (
            args?: unknown,
        ) => (() => unknown) & PromiseLike<unknown>
        const saved = save({ title: 'emma' })
        const awaited = Promise.resolve(saved).then(() => 'landed')
        refresh()
        flushSync()
        answer(
            new Response(JSON.stringify({ saved: 1 }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        const outcome = await Promise.race([
            awaited,
            new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
        ])
        expect(`${outcome}`).toBe('landed')
    } finally {
        globalThis.fetch = answering
    }
})

// 13.17 FOR A BARE `invalidate` TOO: marked in flight, the write's caller pulls the reload, which
// sends the POST again. THE REVERT: drop the `cell.loading` guard from `invalidateIn`; posts reads 2.
test('a bare invalidate during a mutation does not send it again — 13.17', async () => {
    const answers: ((response: Response) => void)[] = []
    const answering = globalThis.fetch
    globalThis.fetch = (() =>
        new Promise<Response>((resolve) => {
            answers.push(resolve)
        })) as unknown as typeof fetch
    const respond = (): void => {
        for (const answer of answers)
            answer(
                new Response(JSON.stringify({ saved: 1 }), {
                    headers: { 'content-type': 'application/json' },
                }),
            )
    }
    try {
        const save = wire('POST', `${LIBRARY}/save`) as (
            args?: unknown,
        ) => (() => unknown) & PromiseLike<unknown>
        const saved = save({ title: 'emma' })
        const awaited = Promise.resolve(saved)
        flushSync()
        invalidate()
        flushSync()
        respond()
        await Promise.race([
            awaited,
            new Promise((resolve) => setTimeout(resolve, 200)),
        ])
        expect(`posts: ${answers.length}`).toBe('posts: 1')
    } finally {
        globalThis.fetch = answering
    }
})

// 18.24 — A BINARY ANSWER IS NOT FOLLOWED: the mux's frames are JSON, and a `Blob` sent as one is
// `{}` written over the bytes. THE REVERT: drop `!binary` from `answerFrom`'s `followable`; a
// `sub` goes out for the cover.
test('a GET answered with a binary is not followed — 18.24', async () => {
    const answering = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png', etag: '"7"' },
        })) as unknown as typeof fetch
    try {
        const cover = wire('GET', `${LIBRARY}/cover`) as (
            args?: unknown,
        ) => PromiseLike<unknown>
        await cover()
        await settle()
        const subs = muxSocket()?.sent.filter(
            (frame) => frame.address === `${LIBRARY}/cover`,
        )
        expect(`subs: ${subs?.length ?? 0}`).toBe('subs: 0')
    } finally {
        globalThis.fetch = answering
    }
})

// 18.25 — A SIGN-IN OR SIGN-OUT REOPENS THE MUX: a connection is answered as the caller it
// opened as, so the old one would go on feeding — or refusing — the caller as they were. THE REVERT:
// drop the `onPrincipalRotated` registration from `Mux`'s constructor; the follow stays on the socket
// it opened on.
test('a sign-in reopens the mux, and every follow is sent again over the new socket — 18.25', async () => {
    shelf = ['dune']
    const guarded = wire('GET', `${LIBRARY}/guarded`) as (
        args?: unknown,
    ) => PromiseLike<unknown>
    await guarded()
    await settle()
    const before = muxSocket()
    const answering = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })) as unknown as typeof fetch
    try {
        await answerOf(
            rpcRequest('POST', `${LIBRARY}/signIn`, {}),
            false,
            undefined,
        )
        await settle()
    } finally {
        globalThis.fetch = answering
    }
    const after = muxSocket()
    const resent = after.sent.some(
        (frame) => frame.op === 'sub' && frame.address === `${LIBRARY}/guarded`,
    )
    expect(
        `${after === before ? 'same socket' : 'reopened'}, resent: ${resent}`,
    ).toBe('reopened, resent: true')
})

// 26.24 — A TAB THAT NEVER READ `principal` STILL TELLS THE OTHERS: the sign-in page whose form calls
// the handler. THE REVERT: drop the `postMessage` from `principalRotated`; the other tab hears nothing.
test('a sign-in tells the other tabs from a tab that never read principal — 26.24', async () => {
    const otherTab = new BroadcastChannel('abide:principal')
    let heard = 0
    otherTab.onmessage = () => {
        heard += 1
    }
    const answering = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response('null', {
            headers: {
                'content-type': 'application/json',
                [PRINCIPAL_HEADER]: 'set',
            },
        })) as unknown as typeof fetch
    try {
        await answerOf(
            rpcRequest('POST', `${LIBRARY}/signIn`, {}),
            false,
            undefined,
        )
        await settle()
    } finally {
        globalThis.fetch = answering
        otherTab.close()
    }
    expect(`heard: ${heard}`).toBe('heard: 1')
})

// 18.24 — NOR IS A REFUSAL: a mux opened as a caller signed in since would feed this one what the
// answer just refused it. THE REVERT: drop the status arms from `wire`'s `follow`; a `sub` goes out
// for the refused read.
test('a GET answered with a refusal is not followed — 18.24', async () => {
    const answering = globalThis.fetch
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), {
            status: 401,
            headers: {
                'content-type': 'application/problem+json',
                etag: '"9"',
            },
        })) as unknown as typeof fetch
    try {
        const ledger = wire('GET', `${LIBRARY}/ledger`) as (
            args?: unknown,
        ) => PromiseLike<unknown>
        await Promise.resolve(ledger()).then(
            () => {},
            () => {},
        )
        await settle()
        const subs = muxSocket()?.sent.filter(
            (frame) => frame.address === `${LIBRARY}/ledger`,
        )
        expect(`subs: ${subs?.length ?? 0}`).toBe('subs: 0')
    } finally {
        globalThis.fetch = answering
    }
})

const muxSockets = (): number =>
    sockets.filter((socket) => socket.url === MUX).length

// The server going away: the stand-in's close, as a browser reports one.
function dropMux(): void {
    const socket = muxSocket()
    socket.readyState = 3
    socket.onclose?.()
}

// `navigator.onLine` as a test sets it, the browser's own taken back by `restore`.
function goOffline(): () => void {
    let onLine = false
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => onLine,
    })
    return () => {
        onLine = true
        delete (navigator as { onLine?: boolean }).onLine
    }
}

// 18.33 — BACK ONLINE, THE MUX REDIALS NOW rather than when its backoff runs out. THE REVERT: drop the
// `online` listener from `Mux`'s constructor; no socket opens until the retry's timer fires.
test('a mux the server closed opens again at once when the browser comes online — 18.33', async () => {
    const atlas = wire('GET', `${LIBRARY}/atlas`) as (
        args?: unknown,
    ) => PromiseLike<unknown>
    await atlas()
    await settle()
    const before = muxSockets()
    dropMux()
    dispatchEvent(new Event('online'))
    expect(`opened: ${muxSockets() - before}`).toBe('opened: 1')
    await settle()
})

// 18.33 — A TAB SHOWN AGAIN REDIALS NOW: a hidden tab's timers are throttled. THE REVERT: drop the
// `visibilitychange` listener; no socket opens until the retry's timer fires.
test('a mux the server closed opens again at once when the page becomes visible — 18.33', async () => {
    const before = muxSockets()
    dropMux()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(`opened: ${muxSockets() - before}`).toBe('opened: 1')
    await settle()
})

// 18.34 — OFFLINE, THE MUX DOES NOT DIAL, and the `online` event is what dials it. THE REVERT: drop the
// `navigator.onLine` guard from `retryLater`; a socket opens once the backoff's 250 ms run out.
test('a mux that closed while offline is not opened again until the browser is online — 18.34', async () => {
    const before = muxSockets()
    const restore = goOffline()
    try {
        dropMux()
        await new Promise((done) => setTimeout(done, 400))
        expect(`opened offline: ${muxSockets() - before}`).toBe(
            'opened offline: 0',
        )
    } finally {
        restore()
    }
    dispatchEvent(new Event('online'))
    expect(`opened online: ${muxSockets() - before}`).toBe('opened online: 1')
    await settle()
})

// 18.35 — A COPY WRITTEN HERE WAITS OUT THE CALLS THAT WROTE IT: a value the server sends before they
// are delivered is the value without them, and taking it would take the edit off the screen. Once
// the line is delivered the copy reads again, and what it reads is the server's. THE REVERT: drop the
// `undelivered()` test from `Following.receive`; the copy takes ['dune'] and 'mine' is gone while
// its call is still waiting.
test('a copy written here takes nothing sent while its calls wait, and reads again once they are delivered — 18.35', async () => {
    shelf = ['dune']
    const stacked = wire('GET', `${LIBRARY}/stacked`) as (
        args?: unknown,
    ) => (() => string[]) &
        PromiseLike<string[]> & {
            synced(): boolean
            patch(mutate: (held: string[]) => void): void
        }
    await stacked()
    await settle()
    const socket = muxSocket()
    const follow = socket.sent.find(
        (frame) => frame.address === `${LIBRARY}/stacked`,
    ) as Sent
    const { deliver } = await import('#ui/outboxQueue.ts')
    const { outbox } = await import('#shared/outbox.ts')
    const answering = globalThis.fetch
    let reachable = false
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            if (!reachable) return new Response(null, { status: 503 })
            shelf = ['dune', 'mine']
            return Response.json({ added: 'mine' })
        }
        return answering(input, init)
    }) as unknown as typeof fetch
    try {
        const shelve = wire('POST', `${LIBRARY}/shelve`) as (
            args: { title: string },
            options: { offline: (args: { title: string }) => unknown },
        ) => PromiseLike<unknown>
        await shelve(
            { title: 'mine' },
            {
                offline: (args) => {
                    stacked().patch((held) => {
                        held.push(args.title)
                    })
                    return { added: args.title }
                },
            },
        )
        await settle()
        expect(stacked()()).toEqual(['dune', 'mine'])
        expect(stacked().synced()).toBe(false)
        socket.push({
            op: 'value',
            id: follow.id,
            version: (follow.version as number) + 5,
            value: ['dune'],
        })
        flushSync()
        expect(stacked()()).toEqual(['dune', 'mine'])
        reachable = true
        deliver()
        await settle()
        await settle()
        expect(outbox()).toEqual([])
        expect(stacked()()).toEqual(['dune', 'mine'])
        expect(stacked().synced()).toBe(true)
    } finally {
        globalThis.fetch = answering
    }
})
