// CLIENT SOCKET MUX (client-sockets.md CS2; shared-cache-plan §2.5) — the browser half of the
// multiplexed WS transport. ONE lazily-opened WebSocket per tab carries EVERY cache-invalidation
// channel AND every user socket, framed by name (`{t:"sub"|"unsub"|"pub"}` upstream, `{name,msg}` /
// `{name,ok}` / `{name,error}` downstream). Subscriptions are re-sent on reconnect (CS2.4) — an
// upgrade over the original cache-only mux, which never reconnected (its TTL self-heals a missed
// frame). Cache channels keep SILENT-DENY (no ack/error handlers); user sockets consume the sub-ack
// (clears `pending()`) and sub-error (terminal `error()`) control frames.
//
// CLIENT-ONLY: imports only a `type` from the server cache-channel module (erased at build) and is a
// total no-op under SSR (no `window`/`WebSocket`), like the rest of the client-only surface.

import { MUX_UPSTREAM } from '../../shared/internal/MUX_UPSTREAM.ts'
import type { MemoFrame } from '../../shared/internal/memoChannels.ts'
import { parseMuxFrame } from '../../shared/internal/parseMuxFrame.ts'
import { subscriptionKey } from '../../shared/internal/subscriptionKey.ts'

// Reconnect backoff bounds (CS2.4). Doubles from MIN to MAX, reset on a clean open.
const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 10_000

// A close code is TERMINAL (stop reconnecting; surface `error()` on socket subs) for a policy
// violation (1008) or any app-defined 4xxx code (e.g. 4401 auth). Everything else — an abnormal
// 1006, a server restart, a transient blip — is transient → reconnect with backoff.
function isTerminalClose(code: number): boolean {
    return code === 1008 || (code >= 4000 && code <= 4999)
}

// One active subscription on the mux, keyed by `subscriptionKey(name, args)`. `name` is the WIRE name (socket /
// channel); `args` is the ROOM (undefined for a void socket / cache channel). `onMessage` receives each
// data frame's payload; `onAck`/`onError` (sockets only) receive the control frames. `replay` is sent on
// the NEXT subscribe frame and then forced true — the first join may be a `replay:false` hydration
// handoff (CS5), but every RECONNECT replays the tail to catch up (CS2.4).
interface Subscription {
    name: string
    args: unknown
    replay: boolean
    onMessage: (payload: unknown) => void
    onAck: (() => void) | undefined
    onError: ((error: unknown) => void) | undefined
    // Called on a transient disconnect (before a reconnect attempt) so a socket sub can surface
    // `refreshing()`. Undefined for cache channels (no visible transport lifecycle).
    onReconnecting: (() => void) | undefined
}

const subscriptions = new Map<string, Subscription>()
// Buffered upstream PUBLISH frames (fire-and-forget) queued while the socket is connecting/reconnecting
// (CS3.4). Subscribe frames are NOT buffered here — they are (re)sent from `subscriptions` on open.
const pendingPublishes: string[] = []

let socket: WebSocket | undefined
let isOpen = false
let base = ''
let reconnectDelay = RECONNECT_MIN_MS
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

// True only in a real browser: `window` + `WebSocket` present. Under SSR (or the server test process,
// which deletes `window`) every entry point below no-ops.
function isBrowser(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof WebSocket !== 'undefined' &&
        typeof location !== 'undefined'
    )
}

// Absolute WS URL for the mux, honoring the mount base (the same prefix clientProxy fetches `/rpc/*`
// under). `wss:` on a secure page, `ws:` otherwise.
function socketUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${location.host}${base}/__abide/sockets`
}

function sendSubscribe(sub: Subscription): void {
    if (socket === undefined || socket.readyState !== 1) return
    // Only carry `replay` when it's the non-default `false` (the CS5 hydration join) — the server
    // treats an absent flag as `replay: true`, keeping the cache-channel wire format unchanged.
    const frame =
        sub.replay === false
            ? { t: MUX_UPSTREAM.sub, name: sub.name, args: sub.args, replay: false }
            : { t: MUX_UPSTREAM.sub, name: sub.name, args: sub.args }
    socket.send(JSON.stringify(frame))
    // After the first send the initial (possibly `false`) replay is spent — a reconnect catches up.
    sub.replay = true
}

// Route one downstream frame to its subscription. Parsing + narrowing is `parseMuxFrame`, shared with
// the test app's client so there is exactly one reader of the server→client contract.
function onMessage(event: MessageEvent): void {
    const frame = parseMuxFrame(String(event.data))
    if (frame === null) return
    // Route by the same room-aware key the sub registered under (the server echoes `args` on roomed
    // frames; omits it for void sockets / cache channels).
    const sub = subscriptions.get(subscriptionKey(frame.name, frame.args))
    if (sub === undefined) return
    if (frame.kind === 'error') sub.onError?.(frame.error)
    else if (frame.kind === 'ack') sub.onAck?.()
    else sub.onMessage(frame.msg)
}

function scheduleReconnect(): void {
    if (reconnectTimer !== undefined) return
    if (subscriptions.size === 0 && pendingPublishes.length === 0) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        ensureSocket()
    }, delay)
}

function ensureSocket(): void {
    if (socket !== undefined) return
    const ws = new WebSocket(socketUrl())
    socket = ws
    ws.addEventListener('open', () => {
        isOpen = true
        reconnectDelay = RECONNECT_MIN_MS
        // (Re)send every active subscription — this is both the first-join path and the reconnect
        // replay (CS2.4). Then flush buffered publishes.
        for (const sub of subscriptions.values()) sendSubscribe(sub)
        for (const frame of pendingPublishes) ws.send(frame)
        pendingPublishes.length = 0
    })
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', (event) => {
        isOpen = false
        socket = undefined
        if (isTerminalClose(event.code)) {
            // Non-retryable: surface a terminal error to socket subscribers and stop (CS10b). The mux
            // connection is dead — drop every subscription (a later active read re-opens fresh). Cache
            // channels have no onError → they simply stop receiving (their TTL self-heals).
            for (const sub of subscriptions.values()) sub.onError?.({ code: event.code })
            subscriptions.clear()
            pendingPublishes.length = 0
            if (reconnectTimer !== undefined) {
                clearTimeout(reconnectTimer)
                reconnectTimer = undefined
            }
            return
        }
        // Transient drop: socket subs go `refreshing()` until the reconnect re-acks (CS4.1).
        for (const sub of subscriptions.values()) sub.onReconnecting?.()
        scheduleReconnect()
    })
    ws.addEventListener('error', () => {
        isOpen = false
    })
}

// Join the mux channel `name` (room `sub.args`). Idempotent per `(name, room)` (dedup) — the caller
// (clientProxy for cache channels, socketProxy for sockets, which refcounts above this) ensures one
// subscription per room. No-op under SSR.
export function muxSubscribe(name: string, sub: Subscription, mountBase?: string): void {
    if (!isBrowser()) return
    const key = subscriptionKey(name, sub.args)
    if (subscriptions.has(key)) return
    if (mountBase !== undefined) base = mountBase
    subscriptions.set(key, sub)
    // Capture openness BEFORE ensureSocket: if the socket was ALREADY open, the open handler won't
    // re-fire for this new sub, so send it now. If it wasn't, `ensureSocket`'s open handler sends every
    // registered subscription (including this one) — sending here too would double-subscribe.
    const wasOpen = isOpen
    ensureSocket()
    if (wasOpen) sendSubscribe(sub)
}

// Leave the mux channel `name` (room `args`). Sends `{t:"unsub"}` when open; always drops the local sub.
export function muxUnsubscribe(name: string, args?: unknown): void {
    if (!isBrowser()) return
    subscriptions.delete(subscriptionKey(name, args))
    if (isOpen && socket !== undefined && socket.readyState === 1) {
        const frame =
            args === undefined
                ? { t: MUX_UPSTREAM.unsub, name }
                : { t: MUX_UPSTREAM.unsub, name, args }
        socket.send(JSON.stringify(frame))
    }
}

// Publish one message upstream on socket `name` into room `args` (fire-and-forget, CS3.4). Buffered and
// flushed on (re)open if the socket is mid-connect. No-op under SSR.
export function muxPublish(name: string, msg: unknown, mountBase?: string, args?: unknown): void {
    if (!isBrowser()) return
    if (mountBase !== undefined) base = mountBase
    const frame = JSON.stringify(
        args === undefined
            ? { t: MUX_UPSTREAM.pub, name, msg }
            : { t: MUX_UPSTREAM.pub, name, args, msg },
    )
    if (isOpen && socket !== undefined && socket.readyState === 1) socket.send(frame)
    else {
        pendingPublishes.push(frame)
        ensureSocket()
    }
}

// Join the `(rpc,args)` cache channel `channelName`, applying each inbound `MemoFrame` via `apply`.
// The cache-channel adapter over the shared mux: silent-deny (no ack/error handlers), replay default.
// No-op under SSR and idempotent per channel (dedup) — the clientProxy computes the SAME name for
// canonically-equal args, so a re-read never re-subscribes.
export function subscribeMemoChannel(
    channelName: string,
    args: unknown,
    apply: (frame: MemoFrame) => void,
    mountBase?: string,
): void {
    muxSubscribe(
        channelName,
        {
            name: channelName,
            args,
            replay: true,
            onMessage: (payload) => apply(payload as MemoFrame),
            onAck: undefined,
            onError: undefined,
            onReconnecting: undefined,
        },
        mountBase,
    )
}
