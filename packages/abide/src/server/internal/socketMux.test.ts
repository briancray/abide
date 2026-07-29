// THE MUX'S RACE GUARDS — the re-check across the authorization `await`.
//
// A subscribe is not atomic: `authorizeSocketJoin` runs the socket's middleware, which is async, and a
// client can unsubscribe, re-subscribe or close while that is in flight. Every join path therefore
// re-checks BOTH the subscription map and `readyState` after the await. Without those checks a closed
// connection is left with a live iterator draining into it — a leak per racing client, on a path
// nothing observes, because the socket is gone and nobody is reading what it produces.
//
// `socketTransport.test.ts` boots a real `Bun.serve` on a real port, so there is no way to hold the
// socket at the instant that matters; a race there is only reachable by timing luck. Making the mux
// depend on `MuxSocket` — the three members it actually touches — is what lets a fake close mid-await
// on demand.

import { describe, expect, test } from 'bun:test'
import type { AppConfig } from './appConfig.ts'
import type { SocketConnectionData } from './channelAuth.ts'
import {
    type MuxSocket,
    pumpSocketToWs,
    type SocketConnection,
    socketOriginAllowed,
    subscribeUserSocket,
} from './socketMux.ts'

const OPEN = 1
const CLOSED = 3

// A `MuxSocket` whose `readyState` the test controls, recording everything sent.
function fakeSocket(): MuxSocket & { sent: string[]; close: () => void } {
    let readyState = OPEN
    const sent: string[] = []
    return {
        get readyState() {
            return readyState
        },
        send(data: string) {
            sent.push(data)
        },
        data: { identity: { id: 'u1' } } as unknown as SocketConnectionData,
        sent,
        close: () => {
            readyState = CLOSED
        },
    }
}

const connection = (): SocketConnection => ({ subscriptions: new Map() })

// A socket whose `middleware` resolves on a promise the test releases, so the join can be held exactly
// at the await the guard protects.
function heldSocket(release: Promise<void>) {
    let subscribes = 0
    return {
        subscribes: () => subscribes,
        sock: {
            __socket: {
                options: {},
                subscribe: () => {
                    subscribes++
                    return {
                        next: () => new Promise(() => {}),
                        return: async () => ({ done: true, value: undefined }),
                    }
                },
            },
        },
        config: {
            sockets: {},
            middleware: [
                async (next: () => unknown) => {
                    await release
                    return next()
                },
            ],
        } as unknown as AppConfig,
    }
}

describe('subscribeUserSocket — the re-check across the await', () => {
    test('a socket CLOSED during authorization is not joined', async () => {
        let releaseAuth: () => void = () => {}
        const release = new Promise<void>((resolve) => {
            releaseAuth = resolve
        })
        const held = heldSocket(release)
        const ws = fakeSocket()
        const conn = connection()
        const sockets = { chat: held.sock } as never

        const joining = subscribeUserSocket(ws, conn, 'chat', undefined, true, sockets, held.config)
        // The client goes away while the middleware is still running.
        ws.close()
        releaseAuth()
        await joining

        // No subscription, and no ack sent into a dead socket.
        expect(conn.subscriptions.size).toBe(0)
        expect(held.subscribes()).toBe(0)
        expect(ws.sent).toEqual([])
    })

    test('an UNSUBSCRIBE during authorization is not overwritten by the late join', async () => {
        let releaseAuth: () => void = () => {}
        const release = new Promise<void>((resolve) => {
            releaseAuth = resolve
        })
        const held = heldSocket(release)
        const ws = fakeSocket()
        const conn = connection()
        const sockets = { chat: held.sock } as never

        const joining = subscribeUserSocket(ws, conn, 'chat', undefined, true, sockets, held.config)
        // A second subscribe for the same room lands first and claims the key.
        conn.subscriptions.set('chat', {
            next: () => new Promise(() => {}),
            return: async () => ({ done: true, value: undefined }),
        } as unknown as AsyncIterator<unknown>)
        releaseAuth()
        await joining

        // Exactly one subscription for the key — the late join must not have replaced it, which would
        // strand the first iterator with nothing left holding a reference to close it.
        expect(conn.subscriptions.size).toBe(1)
        expect(held.subscribes()).toBe(0)
    })

    test('an unknown socket is a terminal sub-error, not silence', async () => {
        // User sockets are OFF silent-deny (CS2): without a frame the client's `pending()` never clears
        // and the subscribe hangs forever with no TTL backstop.
        const ws = fakeSocket()
        const conn = connection()
        await subscribeUserSocket(ws, conn, 'nope', undefined, true, {}, {} as AppConfig)
        expect(ws.sent).toHaveLength(1)
        expect(JSON.parse(ws.sent[0] as string)).toMatchObject({
            name: 'nope',
            error: { message: 'unknown socket: nope' },
        })
        expect(conn.subscriptions.size).toBe(0)
    })

    test('a duplicate subscribe for a key already held is a no-op', async () => {
        const ws = fakeSocket()
        const conn = connection()
        conn.subscriptions.set('chat', {} as AsyncIterator<unknown>)
        await subscribeUserSocket(ws, conn, 'chat', undefined, true, {}, {} as AppConfig)
        // Returns before even looking the socket up — no error frame for a key it already serves.
        expect(ws.sent).toEqual([])
        expect(conn.subscriptions.size).toBe(1)
    })
})

describe('pumpSocketToWs', () => {
    test('stops sending once the socket closes, and closes the iterator', async () => {
        const ws = fakeSocket()
        const conn = connection()
        let produced = 0
        let returned = false
        const iterator: AsyncIterator<unknown> = {
            next: async () => {
                produced++
                if (produced === 2) ws.close()
                return { done: false, value: produced }
            },
            return: async () => {
                returned = true
                return { done: true, value: undefined }
            },
        }
        conn.subscriptions.set('chat', iterator)

        await pumpSocketToWs(ws, conn, 'chat', 'chat', undefined, iterator)

        // The close is observed on the NEXT loop turn, so at most the frames produced before it — and
        // then it STOPS, rather than draining a live iterator into a dead socket forever.
        expect(ws.sent.length).toBeLessThanOrEqual(2)
        expect(produced).toBeLessThanOrEqual(3)
        expect(returned).toBe(true)
    })

    test('a subscription REPLACED under it stops the old pump', async () => {
        // The identity check (`subscriptions.get(key) !== iterator`) rather than a key check: a
        // re-subscribe for the same room installs a new iterator, and the old pump must notice it is no
        // longer the one being served — a key check would let both drain into the socket.
        const ws = fakeSocket()
        const conn = connection()
        let produced = 0
        const iterator: AsyncIterator<unknown> = {
            next: async () => {
                produced++
                if (produced === 2) conn.subscriptions.set('chat', {} as AsyncIterator<unknown>)
                return { done: false, value: produced }
            },
            return: async () => ({ done: true, value: undefined }),
        }
        conn.subscriptions.set('chat', iterator)
        await pumpSocketToWs(ws, conn, 'chat', 'chat', undefined, iterator)
        expect(ws.sent.length).toBeLessThanOrEqual(1)
    })
})

describe('socketOriginAllowed — the CSWSH gate', () => {
    // The ONLY policy a WebSocket upgrade passes. The upgrade short-circuits BEFORE the middleware
    // chain and builds no request scope, so nothing downstream re-checks this.
    const upgrade = (headers: Record<string, string>): Request =>
        new Request('http://localhost:3000/__abide/sockets', { headers })

    const withAppUrl = <T>(value: string | undefined, run: () => T): T => {
        const previous = Bun.env.APP_URL
        if (value === undefined) delete Bun.env.APP_URL
        else Bun.env.APP_URL = value
        try {
            return run()
        } finally {
            if (previous === undefined) delete Bun.env.APP_URL
            else Bun.env.APP_URL = previous
        }
    }

    test('with APP_URL set, a same-origin upgrade is allowed', () => {
        expect(
            withAppUrl('http://localhost:3000', () =>
                socketOriginAllowed(upgrade({ origin: 'http://localhost:3000' })),
            ),
        ).toBe(true)
    })

    test('with APP_URL set, a cross-origin upgrade is REFUSED', () => {
        expect(
            withAppUrl('http://localhost:3000', () =>
                socketOriginAllowed(upgrade({ origin: 'http://evil.example' })),
            ),
        ).toBe(false)
    })

    test('a malformed origin is refused rather than parsed loosely', () => {
        expect(
            withAppUrl('http://localhost:3000', () =>
                socketOriginAllowed(upgrade({ origin: 'not a url' })),
            ),
        ).toBe(false)
    })

    test('an upgrade with NO origin header is allowed — a non-browser client sends none', () => {
        // Browsers always send it on a WS handshake, so its absence means a caller that is not subject
        // to the same-origin policy in the first place.
        expect(withAppUrl('http://localhost:3000', () => socketOriginAllowed(upgrade({})))).toBe(
            true,
        )
    })

    test('WITHOUT APP_URL the gate is open — worth stating, since it is the only policy here', () => {
        // A deployment that never sets APP_URL has no CSWSH protection on the socket upgrade at all.
        // That is the current contract, not an accident of this test; asserting it means a change to it
        // is a deliberate one.
        expect(
            withAppUrl(undefined, () =>
                socketOriginAllowed(upgrade({ origin: 'http://evil.example' })),
            ),
        ).toBe(true)
    })
})
