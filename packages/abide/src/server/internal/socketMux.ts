// THE WEBSOCKET MUX — one connection carrying many subscriptions, and the socket's HTTP face.
//
// A whole transport that lived inside `router.ts`, a file about the HTTP request pipeline, and shared
// almost nothing with it: no `exit()`, no response-header stamping, no CORS, no CSRF, no request scope.
// Its only tie was the `AppConfig` type, which is why moving that out (`appConfig.ts`) is what made
// this separable at all.
//
// What it owns: the per-connection subscription map, the CSWSH origin gate, the pump that drains an
// async iterator into `ws.send`, the three JOIN paths (a user socket's room, an rpc's `(name,args)`
// cache channel, a `@tag:` channel), unsubscribe, publish, and the `GET`/`POST` HTTP face for callers
// with no WebSocket.
//
// The three join paths each RE-CHECK their subscription across the `await` that authorizes it, because
// a client can unsubscribe or close while the check is in flight and would otherwise leave a pump
// draining into a dead socket. `subscribeTagChannel` deliberately has none, and says why.

import { memoChannelHub } from '../../shared/internal/memoChannels.ts'
import type { MuxDownstream } from '../../shared/internal/muxDownstream.ts'
import { subscriptionKey } from '../../shared/internal/subscriptionKey.ts'
import { log } from '../../shared/log.ts'
import { json } from '../json.ts'
import { clientPublishAllowed, type ErasedSocket } from '../socket.ts'
import { sse } from '../sse.ts'
import type { AppConfig } from './appConfig.ts'
import {
    authorizeChannelJoin,
    authorizeSocketJoin,
    authorizeTagJoin,
    isMemoChannel,
    isTagChannel,
    type SocketConnectionData,
} from './channelAuth.ts'
import { enforceMethod } from './enforceMethod.ts'
import { errorResponse } from './errorResponse.ts'

// The only three members of a `Bun.ServerWebSocket` this module touches. Declared STRUCTURALLY, so the
// join paths can be driven with a fake: their correctness turns on a race — a client can unsubscribe or
// close while the authorization `await` is in flight — and re-checking `readyState` across that await is
// the guard. With a real `Bun.serve` on a real port there is no way to hold the socket at the moment
// that matters, which is why those three guards had no test.
export interface MuxSocket {
    readonly readyState: number
    send(data: string): unknown
    readonly data: SocketConnectionData
}

// Per-connection state on the multiplexed socket WS: the set of live subscriptions this client
// holds, keyed by `subscriptionKey(name, args)` → the draining async iterator (so unsub/close can
// `return()` it). The key folds in the room so one connection can hold several rooms of one socket.
export interface SocketConnection {
    subscriptions: Map<string, AsyncIterator<unknown>>
}

// The multiplexed socket transport (sockets.md S3). One WS per client at `/__abide/sockets`
// carries all named sockets, framed `{ name, msg }`. The per-socket HTTP face at
// `/__abide/sockets/<name>` is the WS-less path (GET → SSE subscribe, POST → publish).

// CSWSH gate (auth.md AU8): a cookie-authenticated upgrade must be same-origin. When an Origin
// header is present and APP_URL is configured, reject a mismatched Origin. Origin-less clients
// (native WS, curl) and unconfigured APP_URL pass — a bearer/token WS carries no ambient cookie.
export function socketOriginAllowed(request: Request): boolean {
    const origin = request.headers.get('origin')
    if (origin === null) return true
    const appUrl = Bun.env.APP_URL
    if (appUrl === undefined || appUrl.length === 0) return true
    try {
        return new URL(origin).origin === new URL(appUrl).origin
    } catch {
        return false
    }
}

// Drain one socket's iterator into the WS, framing each message `{ name, args?, msg }`. `subKey` guards
// the subscription slot (roomed sockets share a `name`); `args` (the room, or `undefined`) is echoed so
// the client routes to the right per-room subscription. Ends when the iterator completes, the client
// unsubscribed (replaced/removed in the map), or the WS closed.
export async function pumpSocketToWs(
    ws: MuxSocket,
    connection: SocketConnection,
    subKey: string,
    name: string,
    args: unknown,
    iterator: AsyncIterator<unknown>,
): Promise<void> {
    try {
        while (true) {
            const result = await iterator.next()
            if (result.done === true) break
            if (connection.subscriptions.get(subKey) !== iterator) break
            if (ws.readyState !== 1) break
            const frame: MuxDownstream =
                args === undefined ? { name, msg: result.value } : { name, args, msg: result.value }
            ws.send(JSON.stringify(frame))
        }
    } catch {
        // Swallow — the connection is tearing down; cleanup happens in `finally`.
    } finally {
        await iterator.return?.()
    }
}

export function wsSubscribe(
    ws: MuxSocket,
    connection: SocketConnection,
    name: unknown,
    args: unknown,
    replay: unknown,
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): void {
    if (typeof name !== 'string') return
    // `@rpc:` cache-invalidation channel — the S4.4 exception: per-subscribe authorization against
    // the connection's identity, re-running the target rpc's read gate for the presented args. Cache
    // channels keep SILENT-DENY (their TTL self-heals a missed frame); user sockets do not (below).
    if (isMemoChannel(name)) {
        if (connection.subscriptions.has(name)) return
        void subscribeMemoChannel(ws, connection, name, args, config)
        return
    }
    // `@tag:` cache-tag channel. Same silent-deny class as `@rpc:` (a missed frame self-heals on the
    // next read), but authorized by DECLARATION rather than by re-running a read gate — the frame
    // carries a verb and no payload, so there are no per-args rows to authorize. See `authorizeTagJoin`.
    if (isTagChannel(name)) {
        if (connection.subscriptions.has(name)) return
        subscribeTagChannel(ws, connection, name, config)
        return
    }
    void subscribeUserSocket(ws, connection, name, args, replay, sockets, config)
}

// Authorize + join a USER SOCKET room (ADR 0023 rooms). `args` is the room (undefined = the void
// socket). Unlike cache channels, user sockets are OFF silent-deny (client-sockets.md CS2): an unknown
// socket OR a denied room gets a terminal sub-error frame (→ client `error()`); a successful join gets a
// sub-ack (→ clears client `pending()`). Per-room auth re-runs the socket's `middleware` for the room
// args (`authorizeSocketJoin`); a middleware-less socket is connect-authed. `replay: false` is the
// hydration join — SSR already painted the backlog (CS5).
export async function subscribeUserSocket(
    ws: MuxSocket,
    connection: SocketConnection,
    name: string,
    args: unknown,
    replay: unknown,
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): Promise<void> {
    const key = subscriptionKey(name, args)
    if (connection.subscriptions.has(key)) return
    const sock = sockets[name]
    if (sock === undefined) {
        log.channel('abide:socket').warn(`subscribe rejected — unknown socket: ${name}`)
        ws.send(
            JSON.stringify({
                name,
                error: { message: `unknown socket: ${name}` },
            } satisfies MuxDownstream),
        )
        return
    }
    const allowed = await authorizeSocketJoin(name, sock, args, ws.data, config)
    if (!allowed) {
        log.channel('abide:socket').warn(`subscribe denied — room not authorized: ${name}`)
        ws.send(
            JSON.stringify({
                name,
                args,
                error: { message: 'not authorized' },
            } satisfies MuxDownstream),
        )
        return
    }
    // Re-check across the await: a racing unsub/dup-sub for the same room, or a closed socket, must
    // not leave a dangling join.
    if (connection.subscriptions.has(key)) return
    if (ws.readyState !== 1) return
    const iterator = sock.__socket.subscribe(args, replay !== false)
    connection.subscriptions.set(key, iterator)
    const ack: MuxDownstream = args === undefined ? { name, ok: true } : { name, args, ok: true }
    ws.send(JSON.stringify(ack))
    log.channel('abide:socket').info(`subscribe ${name} replay=${replay !== false}`)
    void pumpSocketToWs(ws, connection, key, name, args, iterator)
}

// Authorize + join an `@rpc:` cache channel. On DENY do nothing (silent — matches the existing
// ignore-unknown-name contract; a client learns nothing about whether the channel exists or why
// it was refused). Re-runs `authorizeChannelJoin` on EVERY subscribe (never cached on the
// connection) so per-args row-level middleware authz is enforced for each join.
async function subscribeMemoChannel(
    ws: MuxSocket,
    connection: SocketConnection,
    name: string,
    args: unknown,
    config: AppConfig,
): Promise<void> {
    const allowed = await authorizeChannelJoin(name, args, ws.data, config)
    if (!allowed) {
        log.channel('abide:socket').trace(`cache-channel join denied: ${name}`)
        return
    }
    // Re-check across the await: a racing unsub/dup-sub for the same name, or a closed socket,
    // must not leave a dangling join.
    if (connection.subscriptions.has(name)) return
    if (ws.readyState !== 1) return
    const iterator = memoChannelHub(name).subscribe()
    connection.subscriptions.set(name, iterator)
    log.channel('abide:socket').trace(`cache-channel join: ${name}`)
    void pumpSocketToWs(ws, connection, name, name, undefined, iterator)
}

// Join an `@tag:` cache-tag channel. Synchronous — the declaration gate is a registry lookup, with no
// middleware chain to await, so there is no across-the-await re-check to make.
function subscribeTagChannel(
    ws: MuxSocket,
    connection: SocketConnection,
    name: string,
    config: AppConfig,
): void {
    if (!authorizeTagJoin(name, config)) {
        log.channel('abide:socket').trace(`tag-channel join denied: ${name}`)
        return
    }
    if (ws.readyState !== 1) return
    const iterator = memoChannelHub(name).subscribe()
    connection.subscriptions.set(name, iterator)
    log.channel('abide:socket').trace(`tag-channel join: ${name}`)
    void pumpSocketToWs(ws, connection, name, name, undefined, iterator)
}

export function wsUnsubscribe(connection: SocketConnection, name: unknown, args: unknown): void {
    if (typeof name !== 'string') return
    const key = subscriptionKey(name, args)
    const iterator = connection.subscriptions.get(key)
    if (iterator === undefined) return
    connection.subscriptions.delete(key)
    void iterator.return?.()
}

// Client publish over the WS into room `args` (undefined = the void socket). Ignored unless the socket
// opted into `clientPublish`; a roomed publish is ALSO per-room authorized (`authorizeSocketJoin`) — the
// same gate as subscribe, so a client cannot publish into a room it may not join. Routed through the
// socket's `ingressPublish` so a mediating `handler` can transform / drop / reject.
export async function wsPublish(
    ws: MuxSocket,
    name: unknown,
    args: unknown,
    message: unknown,
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): Promise<void> {
    if (typeof name !== 'string') return
    const sock = sockets[name]
    if (sock === undefined) return
    if (!clientPublishAllowed(sock.__socket.options.clientPublish)) return
    if (!(await authorizeSocketJoin(name, sock, args, ws.data, config))) {
        log.channel('abide:socket').warn(`publish denied — room not authorized: ${name}`)
        return
    }
    try {
        await sock.__socket.ingressPublish(args, message)
    } catch {
        // A handler reject is surfaced to WS publishers as a silent drop (no request/response pair).
    }
}

// The per-socket HTTP face: GET/HEAD → SSE subscribe, POST → publish (respecting clientPublish).
//
// Reached from `dispatch`, INSIDE the request scope — so it runs the middleware onion (global + this
// socket's own), the CSRF gate, and the response stamping, exactly like an rpc. It used to return
// straight out of `Bun.serve.fetch` ~110 lines above all of that, which meant a state-changing,
// cookie-authenticated POST ran no middleware and no CSRF check: `export const middleware = [auth]`
// did not protect a socket publish, and the reply carried no identity cookie and no traceparent.
//
// SSE subscribe on GET, publish on POST — the two verbs it serves, declared once and handed to the
// one gate. HEAD rides with GET.
const SOCKET_FACE_METHODS = ['GET', 'POST'] as const

export async function socketHttpFace(
    request: Request,
    name: string,
    sockets: Record<string, ErasedSocket>,
): Promise<Response> {
    const sock = sockets[name]
    if (sock === undefined) return errorResponse(404, `Unknown socket: ${name}`)

    const denied = enforceMethod(request, SOCKET_FACE_METHODS)
    if (denied !== undefined) return denied

    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
        return sse(sock)
    }
    {
        if (!clientPublishAllowed(sock.__socket.options.clientPublish)) {
            return errorResponse(403, `socket: client publish is disabled for ${name}.`)
        }
        const body = await request.text()
        const message = body.length > 0 ? JSON.parse(body) : undefined
        try {
            // The WS-less HTTP face operates on the void room (no room selector in the URL).
            await sock.__socket.ingressPublish(undefined, message)
        } catch (caught) {
            return errorResponse(
                400,
                caught instanceof Error ? caught.message : 'socket publish rejected',
            )
        }
        return json({ ok: true })
    }
}
