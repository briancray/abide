// Cache-broadcast channel registry — rpc-core §8 broadcast substrate (server→server, PR2).
//
// Lives in `shared/internal/` (ADR 0026) because it depends on nothing above it: a `ChannelHub` and a
// channel name, both `shared/`. Its CALLERS are server-side — a shared memo is server-only
// (`memo.ts`: `shared === true && !isBrowser`) — but placement follows dependencies, not callers, so
// `shared/memoTags.ts` can reach it without importing up out of the bottom layer.
//
// When a SHARED memo slot is invalidated/refreshed/published, the verb is published onto a
// per-`(rpc,args)` channel so subscribers elsewhere can mirror it. The transport is REUSED
// verbatim: each channel is a `ChannelHub<MemoFrame>` — the same bounded fanout that backs named
// user sockets. No new transport is invented here.
//
// Channel naming lives in the reserved `@` namespace (`@rpc:<rpc>:<canonicalKey(args)>`). User
// socket names are bare (`config.sockets` keys, no `:` / `@`), so an `@rpc:` channel can never
// collide with a user socket name. The WS-facing join path (with auth) is PR3 — this slice only
// wires server→hub publishing plus a hub registry that a test can subscribe to directly.

import { ChannelHub } from './channelHub.ts'
import { memoChannelName, RPC_CHANNEL_PREFIX } from './memoChannelName.ts'
import { TAG_CHANNEL_PREFIX, tagChannelName } from './tagChannelName.ts'

// Re-exported from the client-safe modules so existing server importers keep importing them from here.
// A name must be IDENTICAL on server and client (the browser mux computes both), so each lives in
// `shared/` where both sides can reach it without pulling server transport into the client bundle.
export { memoChannelName, RPC_CHANNEL_PREFIX, TAG_CHANNEL_PREFIX, tagChannelName }

// One broadcast frame on a `(rpc,args)` channel. `value` is present ONLY for value-form `publish`
// (an updater-form publish on a shared slot resolves server-side and broadcasts its RESULT here).
export interface MemoFrame {
    verb: 'invalidate' | 'refresh' | 'publish'
    value?: unknown
}

// Lazy per-channel hubs. A channel exists only once something subscribes (or publishes) to it.
const channels = new Map<string, ChannelHub<MemoFrame>>()

// Get-or-create the hub for a channel. Tests (and PR3's WS join path) subscribe through this.
export function memoChannelHub(name: string): ChannelHub<MemoFrame> {
    let hub = channels.get(name)
    if (hub === undefined) {
        hub = new ChannelHub<MemoFrame>({})
        channels.set(name, hub)
    }
    return hub
}

// Publish a frame onto a channel. No-op when nothing has subscribed (no hub) — cache frames are
// ephemeral (no tail replay), so a channel with no listeners has nothing to receive them.
export function publishMemoFrame(name: string, frame: MemoFrame): void {
    const hub = channels.get(name)
    if (hub === undefined) return
    hub.publish(frame)
}
