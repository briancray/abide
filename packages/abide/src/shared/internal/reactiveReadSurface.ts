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
//     key is last-or-only, and TypeScript's omittable-`void`-parameter rule collapses `live(args: void)`
//     to `live()` for free. An RPC takes `RpcCallArgs<Args>`, which makes the slot OPTIONAL, because a
//     zero-arg rpc infers `Args = unknown` rather than `void` and so gets no free collapse. Forcing
//     either into the other's shape breaks real call sites.
// (2) CARDINALITY. A value read has no transcript, so the VALUE half (the display read `live` plus four
//     probes) and the STREAM half (the transcript read `chunks` plus two probes) are separate interfaces.
//     `RpcCallSurface` takes only the value half; a socket and a streaming read take both. Folding them
//     into one would put `chunks`/`done`/`streaming` on every scalar rpc.
//
// What is deliberately NOT here: `refresh`/`invalidate`/`watch` live on `ReactiveReadSurface` below, one
// level up, because a socket implements none of them (`server/socket.ts` and `ui/internal/socketProxy.ts`
// each assign exactly ten members — the two reads `live`/`peek`, the six probes, the transcript read
// `chunks`, plus `publish`). Folding the verbs down would widen the socket's public surface with three
// members nothing implements, which is a feature, not a unification.

// THE UNTRACKED READ — its own declaration, because it is not a probe and putting it back among them is
// what made `peek` mean two opposite things for so long.
//
// A probe wakes for its own axis; this wakes for nothing. It reads what is already there and does
// NOTHING else: no subscription, no load, no subscription-open on a socket. That is the meaning TC39
// Signals and the wider ecosystem carry, and as of this change it is the meaning on all three primitives —
// `state.peek()` is the one remaining spelling of the same idea and should retire into this name.
//
// Split from `ReactiveValueProbes` rather than left inside it: every member there is annotated "Reactive."
// and this one is the negation of that, so it was a lie sitting inside a declaration whose entire purpose
// is that four surfaces cannot drift from it. Declared once and instantiated at each surface's own arity,
// exactly as the two probe halves are — an RPC's key is optional, a primitive's is last-or-only.
export interface UntrackedRead<T, A extends unknown[]> {
    // The pure snapshot: the value the slot HOLDS right now, or `undefined` if it holds none. Stream/socket:
    // the latest chunk/message already received. Never subscribes and never acquires, so a caller reading
    // only this sees a value if something else put one there and never learns that it changed.
    //
    // For the DISPLAY read — subscribe, and acquire if cold — use `live()`. That is what a template wants
    // and what `{fn.live(args)}` spells; this is the escape hatch for the cases that must not participate:
    // reading a slot inside an untracked region, an event handler that wants "what is on screen right
    // now", a test asserting a slot was NOT filled.
    peek(...args: A): T | undefined
}

export interface ReactiveValueProbes<T, A extends unknown[]> {
    // THE DISPLAY READ — the reactive non-blocking snapshot. Scalar: the current value (sticky).
    // Stream/socket: the latest chunk/message (socket additionally age-windows it by `maxAge`).
    // `undefined` while pending / empty.
    //
    // Reactive AND acquiring: reading it subscribes the caller and kicks a coalesced load when the slot is
    // cold, which is what makes `{fn.live(args)}` fill in on its own. It carried the name `peek` until this
    // change, against the ecosystem's meaning of that word and against `state.peek()` next door; the
    // two behaviours now have two names instead of one name and a footnote.
    live(...args: A): T | undefined
    // No value yet (first acquisition in flight). Reactive.
    pending(...args: A): boolean
    // Re-acquiring over a retained value/tail. Reactive.
    refreshing(...args: A): boolean
    // The acquisition reached a TERMINAL outcome. Scalar: a retained value or error. Stream: the
    // transcript closed, failed OR was aborted. Socket: the subscription ended (a socket is eternal, so
    // effectively false once live). Reactive.
    //
    // Deliberately NOT `done`, and the difference is load-bearing rather than pedantic. A stream carries
    // three MUTUALLY EXCLUSIVE terminals (`replayableStream.ts:27-31`) and only `close()` sets `done` —
    // so a stream killed by `fail()` (a `TimeoutError`), by `abort()` (invalidate / policy) or by
    // `markOverflowed()` (the per-stream buffer cap) answers `done() === false` FOREVER, while
    // `consume()` has already thrown or returned and no chunk will ever arrive again. `done` means
    // "ended cleanly"; this means "ended". Rendering a spinner off `!done()` is how that becomes a
    // permanent spinner, and until this probe existed the public surface could not see the difference —
    // though `ReplayableStream` had already named the union correctly (`get settled()`), which is where
    // the name comes from.
    //
    // It is also the only way to tell a COLD slot from a settled one: `pending()` is false for both idle
    // and settled, and neither read can separate them either (a settled `undefined` value reads
    // identically to nothing-yet). `!settled() && !pending()` is "never asked".
    settled(...args: A): boolean
    // Retained error (a stream slot's error is read off its buffer). Reactive.
    error(...args: A): unknown
}

export interface ReactiveStreamProbes<C, A extends unknown[]> {
    // Stream/socket transcript snapshot; `undefined` for a scalar slot. Reactive.
    chunks(...args: A): C[] | undefined
    // Stream closed CLEANLY (`close()`). Scalar: n/a. Socket: eternal, so effectively false once live.
    // Reactive. For "ended by any route, including a failure or an abort", ask `settled()` — the two
    // differ on exactly the stream that stopped without finishing.
    done(...args: A): boolean
    // A transcript is OPEN and delivering: chunks may still arrive. Scalar slot: always false. Socket: the
    // subscription is live. Reactive.
    //
    // This is the probe that makes the stream axis three-state and readable — `pending()` (nothing yet) →
    // `streaming()` (arriving) → `settled()` (ended, however it ended). Before it, `done() === false` was
    // the answer for a scalar slot, an idle slot, an open stream AND a stream that died mid-flight, so
    // "is this still coming?" had no honest spelling. The nearest workaround —
    // `chunks() !== undefined && !done()` — copies the whole transcript to answer a boolean, and inherits
    // the failed-stream blind spot from `done`.
    //
    // A STATUS probe, so it observes and never opens (client-sockets.md CS4.1): asking whether something
    // is streaming must not be what starts it streaming. That holds with NO exceptions — see the note on
    // this interface pair below.
    streaming(...args: A): boolean
}

// A PROBE OBSERVES; IT NEVER CAUSES — and that is a rule over the two interfaces above, not a property
// each implementation gets to interpret.
//
// The vocabulary splits three ways, and only the first group acquires:
//   • READS that acquire — `live` (subscribe + kick a cold load) and `chunks` (the transcript, which on a
//     socket is what opens the subscription at all). `{#for m of feed.chunks()}` renders the data, so a
//     `chunks` that acquired nothing would paint an empty list forever.
//   • The READ that acquires nothing — `peek`.
//   • The PROBES — `pending`, `refreshing`, `settled`, `error`, `done`, `streaming`. These start no load,
//     open no subscription, and move no LRU/retention position.
//
// Stated here because it did not hold and the breaches were invisible. `done` reached `startLoad` through
// the same helper `chunks` uses, so "has this finished?" started it; and on an ARGLESS memo every probe
// that classified the body (`error`, `settled`, `streaming`, `done`) RAN it to do so — on a deferred body
// that fires the load, which made `{#if job.settled()}` the thing that launched the job it was asking
// about. The cost of the rule is that a probe on an argless memo whose body has never run reports the cold
// answer until a READ classifies it; that is honest, and it is what `pending` always did.
//
// The both-halves surface at the PRIMITIVE arity (key last-or-only). What `memo`, `channel` and
// `socket` share; the transported RPC forms instantiate the two halves directly with their own tuple.
export interface ReactiveProbeSurface<Args, T>
    extends UntrackedRead<T, [args: Args]>,
        ReactiveValueProbes<T, [args: Args]>,
        ReactiveStreamProbes<unknown, [args: Args]> {}

// The two SELECTOR verbs, declared once. Unlike the probes these need NO arity parameter: both take the
// partial selector in the same optional slot on every surface that has them, so the memo/rpc spellings
// were already byte-identical — which is precisely why they were re-typed by hand on `RpcCallSurface`
// for as long as they were. A partial selector matches every superset slot (spec: partial-object match);
// calling with no argument selects the whole callable.
export interface SlotSelectorVerbs<Args> {
    // EAGER re-acquire: a memo re-runs its `fn` keeping the stale value visible; a socket re-subscribes
    // keeping the tail visible until the new subscription is live.
    refresh(args?: Partial<Args> | Args): void
    // LAZY re-acquire: drop, then re-acquire on next read. Per-cardinality — a PUSH (socket) slot has no
    // source to abort; it clears the retained tail and re-subscribes on next read, it does NOT abort a
    // pulled source the way a memo-stream's `invalidate` does.
    invalidate(args?: Partial<Args> | Args): void
}

export interface ReactiveReadSurface<Args, T>
    extends ReactiveProbeSurface<Args, T>,
        SlotSelectorVerbs<Args> {
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
