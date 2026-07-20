// CLIENT CACHE MUX (shared-cache-plan §2.5) — the browser half of the server SHARED cache broadcast.
//
// A browser cell reading a `shared` RPC auto-subscribes (via clientProxy) to its `(rpc,args)`
// invalidation channel over ONE lazily-opened WS per tab, reusing the same multiplexed socket
// transport (`/__abide/sockets`) and frame protocol as user sockets: subscribe with
// `{t:"sub", name, args}` (the raw `args` are REQUIRED by the server's args-spoof + per-args auth
// check, PR3), receive framed `{name, msg}` where `msg` is a `CacheFrame`.
//
// CLIENT-ONLY: this module drags NO server code into the bundle — it imports only a `type` from the
// server cache-channel module (erased at build) and is a total no-op under SSR (no `window`/
// `WebSocket`), like the rest of the client-only surface.
//
// ROBUSTNESS is intentionally minimal (best-effort): a dropped socket is not reconnected and its
// subscriptions are not replayed. A missed invalidation is harmless — the cell's TTL (or the next
// explicit `refresh`/`invalidate`) re-fetches, so staleness self-heals. Only `@rpc:` (per-args
// authorized) channels are ever joined here; `@tag:` channels have no client auth story and are
// deferred.

import type { CacheFrame } from '../../server/internal/cacheChannels.ts'

// One inbound-frame handler per channel. Keyed by channel name so a channel is joined at most once
// (dedup): the clientProxy computes the SAME name for canonically-equal args, so a re-read never
// re-subscribes.
const handlers = new Map<string, (frame: CacheFrame) => void>()

// Subscribe frames queued while the socket is still connecting; flushed on `open`.
const pending: string[] = []

let socket: WebSocket | undefined
let isOpen = false

// True only in a real browser: `window` + `WebSocket` present. Under SSR (or the server test
// process, which deletes `window`) every entry point below no-ops.
function isBrowser(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof WebSocket !== 'undefined' &&
        typeof location !== 'undefined'
    )
}

// Absolute WS URL for the mux, honoring the mount base (the same prefix clientProxy fetches
// `/rpc/*` under). `wss:` on a secure page, `ws:` otherwise.
function socketUrl(base: string | undefined): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${location.host}${base ?? ''}/__abide/sockets`
}

function onMessage(event: MessageEvent): void {
    let framed: { name?: unknown; msg?: unknown }
    try {
        framed = JSON.parse(String(event.data))
    } catch {
        return
    }
    if (typeof framed.name !== 'string') return
    const handler = handlers.get(framed.name)
    if (handler === undefined) return
    handler(framed.msg as CacheFrame)
}

function ensureSocket(base: string | undefined): void {
    if (socket !== undefined) return
    const ws = new WebSocket(socketUrl(base))
    socket = ws
    ws.addEventListener('open', () => {
        isOpen = true
        for (const frame of pending) ws.send(frame)
        pending.length = 0
    })
    ws.addEventListener('message', onMessage)
    // Best-effort: on close/error drop the socket so a later subscribe re-opens it. Existing handlers
    // stay registered (their next inbound frame after a re-open would need a fresh subscribe, but the
    // TTL/refetch backstop covers the gap — see file header).
    ws.addEventListener('close', () => {
        isOpen = false
        socket = undefined
    })
    ws.addEventListener('error', () => {
        isOpen = false
    })
}

// Join the `(rpc,args)` cache channel `channelName`, applying each inbound `CacheFrame` via `apply`.
// No-op under SSR and idempotent per channel (dedup). `args` are sent RAW in the subscribe frame —
// the server verifies they name the channel and re-authorizes the join against them (PR3).
export function subscribeCacheChannel(
    channelName: string,
    args: unknown,
    apply: (frame: CacheFrame) => void,
    base?: string,
): void {
    if (!isBrowser()) return
    if (handlers.has(channelName)) return
    handlers.set(channelName, apply)
    ensureSocket(base)
    const frame = JSON.stringify({ t: 'sub', name: channelName, args })
    if (isOpen && socket !== undefined && socket.readyState === 1) socket.send(frame)
    else pending.push(frame)
}
