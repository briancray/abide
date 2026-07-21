// Cache-broadcast channel registry — rpc-core §8 broadcast substrate (server→server, PR2).
//
// When a SHARED cell slot is invalidated/refreshed/amended, the verb is published onto a
// per-`(rpc,args)` channel so subscribers elsewhere can mirror it. The transport is REUSED
// verbatim: each channel is a `SocketHub<CacheFrame>` — the same bounded fanout that backs named
// user sockets. No new transport is invented here.
//
// Channel naming lives in the reserved `@` namespace (`@rpc:<rpc>:<canonicalKey(args)>`). User
// socket names are bare (`config.sockets` keys, no `:` / `@`), so an `@rpc:` channel can never
// collide with a user socket name. The WS-facing join path (with auth) is PR3 — this slice only
// wires server→hub publishing plus a hub registry that a test can subscribe to directly.

import { cacheChannelName } from '../../shared/internal/cacheChannelName.ts'
import { SocketHub } from './socketHub.ts'

// Re-exported from the client-safe module so existing server importers keep importing it from here.
// The name must be IDENTICAL on server and client (the browser mux computes it too), so it lives in
// `shared/` where both sides can reach it without pulling server transport into the client bundle.
export { cacheChannelName }

// One broadcast frame on a `(rpc,args)` channel. `value` is present ONLY for value-form `amend`
// (an updater-form amend on a shared slot resolves server-side and broadcasts its RESULT here).
export interface CacheFrame {
    verb: 'invalidate' | 'refresh' | 'amend'
    value?: unknown
}

const TAG_CHANNEL_PREFIX = '@tag:'

// Lazy per-channel hubs. A channel exists only once something subscribes (or publishes) to it.
const channels = new Map<string, SocketHub<CacheFrame>>()

// Deterministic channel name for a cache TAG (rpc-core §8, shared-cache-plan §2.4). A global
// `invalidate/refresh({ tags })` publishes one frame here per listed tag so a client subscribed at
// the tag level (bare-tag subscription is deferred, but the substrate is complete) mirrors it.
// Reserved `@tag:` prefix keeps it distinct from both `@rpc:` channels and bare user-socket names.
export function tagChannelName(tag: string): string {
    return TAG_CHANNEL_PREFIX + tag
}

// Get-or-create the hub for a channel. Tests (and PR3's WS join path) subscribe through this.
export function cacheChannelHub(name: string): SocketHub<CacheFrame> {
    let hub = channels.get(name)
    if (hub === undefined) {
        hub = new SocketHub<CacheFrame>({})
        channels.set(name, hub)
    }
    return hub
}

// Publish a frame onto a channel. No-op when nothing has subscribed (no hub) — cache frames are
// ephemeral (no tail replay), so a channel with no listeners has nothing to receive them.
export function publishCacheFrame(name: string, frame: CacheFrame): void {
    const hub = channels.get(name)
    if (hub === undefined) return
    hub.publish(frame)
}
