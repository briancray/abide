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

// THE PROBE VOCABULARY, declared once. It was hand-copied into FIVE interfaces — this one,
// `SocketSurface`, `RpcCallSurface`, `StreamRead`, and `emitCheck`'s compiler shims — each extending
// nothing, which is the exact rot ADR 0027 names (a rule stated at the root and enforced one layer
// short of the leaves) surviving at the type level after D4 fixed the runtime half. The drift was
// already visible: `StreamRead` had no `refreshing` while `RpcCallSurface` did, for no stated reason.
//
// Two axes had to be parameterized before the four could share one declaration:
//
// (1) ARITY. Each surface spells its key differently and each spelling is load-bearing, so the tuple is
//     a parameter rather than something to normalize. A memo/channel/socket takes `[args: Args]` — the
//     key is last-or-only, and TypeScript's omittable-`void`-parameter rule collapses `peek(args: void)`
//     to `peek()` for free. An RPC takes `RpcCallArgs<Args>`, which makes the slot OPTIONAL, because a
//     zero-arg rpc infers `Args = unknown` rather than `void` and so gets no free collapse. Forcing
//     either into the other's shape breaks real call sites.
// (2) CARDINALITY. A value read has no transcript, so the four VALUE probes and the two STREAM probes
//     are separate interfaces. `RpcCallSurface` takes only the value half; a socket and a streaming read
//     take both. Folding them into one would put `chunks`/`done` on every scalar rpc.
//
// What is deliberately NOT here: `refresh`/`invalidate`/`watch` live on `ReactiveReadSurface` below, one
// level up, because a socket implements none of them (`server/socket.ts` and `ui/internal/socketProxy.ts`
// each assign exactly seven members — six probes plus `publish`). Folding the verbs down would widen the
// socket's public surface with three members nothing implements, which is a feature, not a unification.
export interface ReactiveValueProbes<T, A extends unknown[]> {
    // Non-blocking snapshot. Scalar: the current value (sticky). Stream/socket: the latest chunk/message
    // (socket additionally age-windows it by `maxAge`). Reactive; `undefined` while pending / empty.
    peek(...args: A): T | undefined
    // No value yet (first acquisition in flight). Reactive.
    pending(...args: A): boolean
    // Re-acquiring over a retained value/tail. Reactive.
    refreshing(...args: A): boolean
    // Retained error (a stream slot's error is read off its buffer). Reactive.
    error(...args: A): unknown
}

export interface ReactiveStreamProbes<C, A extends unknown[]> {
    // Stream/socket transcript snapshot; `undefined` for a scalar slot. Reactive.
    chunks(...args: A): C[] | undefined
    // Stream closed. Scalar: n/a. Socket: eternal, so effectively false once live. Reactive.
    done(...args: A): boolean
}

// The both-halves surface at the PRIMITIVE arity (key last-or-only). What `memo`, `channel` and
// `socket` share; the transported RPC forms instantiate the two halves directly with their own tuple.
export interface ReactiveProbeSurface<Args, T>
    extends ReactiveValueProbes<T, [args: Args]>,
        ReactiveStreamProbes<unknown, [args: Args]> {}

export interface ReactiveReadSurface<Args, T> extends ReactiveProbeSurface<Args, T> {
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
