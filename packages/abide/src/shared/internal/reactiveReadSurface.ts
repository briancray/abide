// The shared REACTIVE-READ SURFACE (ADR 0023 §4). The probe/verb vocabulary that BOTH a `memo` slot
// (scoped / lossless / LRU) and a `socket`/`channel` (global / lossy / hub) implement — the one concept
// they share, over two honest storage strategies. A caller programs to this surface and never branches on
// the storage.
//
// The vocabulary is uniform; the per-cardinality SEMANTICS are documented per method and pinned here in the
// TYPED contract (not just in prose) so the two implementations cannot silently drift into a
// "uniform-but-lying" interface. `Args` keys a memo by its handler args; a single-topic socket instantiates
// it as `void`.

import type { Room } from './room.ts'

export interface ReactiveReadSurface<Args, T> {
    // Non-blocking snapshot. Scalar: the current value (sticky). Stream/socket: the latest chunk/message
    // (socket additionally age-windows it by `maxAge`). Reactive; `undefined` while pending / empty.
    peek(args: Args): T | undefined
    // No value yet (first acquisition in flight). Reactive.
    pending(args: Args): boolean
    // Re-acquiring over a retained value/tail. Reactive.
    refreshing(args: Args): boolean
    // Retained error (a stream slot's error is read off its buffer). Reactive.
    error(args: Args): unknown
    // Stream/socket transcript snapshot; `undefined` for a scalar slot. Reactive.
    chunks(args: Args): unknown[] | undefined
    // Stream closed. Scalar: n/a. Socket: eternal, so effectively false once live. Reactive.
    done(args: Args): boolean
    // EAGER re-acquire: a memo re-runs its `fn` keeping the stale value visible; a socket re-subscribes
    // keeping the tail visible until the new subscription is live.
    refresh(args?: Partial<Args> | Args): void
    // LAZY re-acquire: drop, then re-acquire on next read. Per-cardinality — a PUSH (socket) slot has no
    // source to abort; it clears the retained tail and re-subscribes on next read, it does NOT abort a
    // pulled source the way a memo-stream's `invalidate` does.
    invalidate(args?: Partial<Args> | Args): void
    // The single write verb, cardinality-polymorphic: REPLACE on a scalar slot, APPEND on a stream/socket
    // slot. Takes a VALUE — the read-modify-write updater form is scalar-only and lives on `Memo` (a
    // channel only appends, so an updater is meaningless there), so it is NOT in the shared surface.
    //
    // The KEY is a `Room` positional, so an argless callable never writes an `undefined` placeholder:
    // `publish(msg)` when `Args` is void, `publish({room}, msg)` when it names a room.
    publish(...args: [...Room<Args>, next: T]): void
    // The generic-safe form. Code that forwards an UNRESOLVED `Args` (the client proxy, the broadcast-frame
    // applier) cannot spread a deferred conditional tuple, so the explicit two-argument call stays legal;
    // it is also what a void surface's `Room` collapses away from, and both arities unpack identically.
    publish(args: Args, next: T): void
    // Run `handler` on slot change; returns a dispose fn. Scalar: fires on an actual value change (a
    // `refreshing` flag-flip is not one). Stream/socket: fires per chunk/message append, handing over the
    // latest (coalesced per flush).
    //
    // The other verb with a TRAILING payload, so the key is the same `Room` positional `publish` takes —
    // `watch(handler)` on an argless/void surface, `watch({ room }, handler)` on a keyed one.
    watch(...args: [...Room<Args>, handler: (value: T | undefined) => void]): () => void
    // The generic-safe form (see `publish`).
    watch(args: Args, handler: (value: T | undefined) => void): () => void
}
