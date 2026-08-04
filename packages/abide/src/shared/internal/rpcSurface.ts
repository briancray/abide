// The ISOMORPHIC RPC CALL SURFACE (ADR 0027 D10) — the half of `Rpc` that both sides really implement.
//
// `Rpc` used to declare the call surface AND the server-side construction meta (`__rpc: RpcMeta`, which
// reaches `RpcOptions` → middleware/CORS/schemas). That forced `ui/internal/clientProxy.ts` to import
// from `server/internal/`, breaking the one-way layering — and it was not even true: the browser proxy
// implements every member here honestly (including a deliberately-inert `bindBroadcast`) but has no
// `__rpc`, which is why it needed a cast.
//
// So the split is along the seam that already existed: everything the two sides SHARE lives here, and
// `server/internal/makeRpc.ts` adds the one server-only member on top (`Rpc extends RpcCallSurface`).
// This is the type-level statement of CLAUDE.md's "isometric RPC consumption" section — the call
// surface is identical for reads and mutations, on the server and in the browser.

import type { MemoNotify } from '../memo.ts'
import type { HydrationSeedSurface } from './hydrationSeed.ts'
import type {
    ReactiveValueProbes,
    SlotSelectorVerbs,
    UntrackedRead,
} from './reactiveReadSurface.ts'

// A read-call argument tuple. A ZERO-arg read infers `Args = unknown`, which makes the argument
// OPTIONAL so a bare `fn()` type-checks; a declared arg stays REQUIRED because `Args` is then a
// concrete shape — exactly the discriminator between "no declared input" and "declared input".
export type RpcCallArgs<Args> = unknown extends Args ? [args?: Args] : [args: Args]

// Per-call options on the BARE CALL only (ADR 0028 D3) — `fn(args, { signal })`. A caller's signal
// aborts THEIR wait, never the run; that is what makes a per-call timeout need no API of its own
// (`fn(args, { signal: AbortSignal.timeout(500) })` is one, composed from the platform).
//
// It trails the arg slot, and a zero-arg rpc therefore writes `fn(undefined, { signal })`. The leading
// slot does not collapse, because a zero-arg rpc infers `Args = unknown` rather than `void` — the same
// reason `rpc.publish(args, value)` keeps its arg slot. A trailing options bag cannot be confused with
// a leading args object the way a single collapsed parameter could.
export interface RpcCallOptions {
    signal?: AbortSignal
}

// The BARE CALL's argument tuple — the args slot plus the trailing options bag. Spelled out rather than
// built as `[...RpcCallArgs<Args>, options?]`: a tuple with an OPTIONAL element cannot be spread and
// then extended, so the appended member was silently dropped for the zero-arg case and
// `fn(undefined, { signal })` reported "Expected 0-1 arguments". The probes keep the plain
// `RpcCallArgs` — per-call options belong to the call, not to `peek`/`pending`/`error`.
export type RpcInvokeArgs<Args> = unknown extends Args
    ? [args?: Args, options?: RpcCallOptions]
    : [args: Args, options?: RpcCallOptions]

export type MutationInvokeArgs<Args> = unknown extends Args
    ? [args?: Args | FormData, options?: RpcCallOptions]
    : [args: Args | FormData, options?: RpcCallOptions]

// A mutation-call argument tuple — same zero-arg discriminator as `RpcCallArgs`, but a mutation also
// accepts a `FormData` in the arg slot. A ZERO-arg mutation (`POST(() => …)`) makes the argument
// OPTIONAL so a bare `fn()` type-checks (parity with a zero-arg read); a declared arg stays REQUIRED.
export type MutationCallArgs<Args> = unknown extends Args
    ? [args?: Args | FormData]
    : [args: Args | FormData]

// The five VALUE probes (`live`/`pending`/`refreshing`/`settled`/`error`) plus the untracked `peek`
// are INHERITED from
// `ReactiveValueProbes` at this surface's own arity, rather than re-listed. They were hand-copied and
// this interface extended nothing — see the note on `ReactiveValueProbes` for why that mattered and why
// the arity is a parameter instead of something normalized away. Only the value half: a scalar read has
// no transcript, so `chunks`/`done`/`streaming` stay off it and `StreamRead` adds them.
export interface RpcCallSurface<Args, T>
    extends UntrackedRead<T, RpcCallArgs<Args>>,
        ReactiveValueProbes<T, RpcCallArgs<Args>>,
        // The §5 seed triple, at the SAME arity a memo takes it (all three name the key explicitly, so
        // there is nothing to re-parameterize). Inherited rather than restated — restating it is how
        // `seedStream` came to accept `StreamSeed` on the memo and not here.
        HydrationSeedSurface<Args, T>,
        // The two selector verbs, likewise inherited rather than restated.
        SlotSelectorVerbs<Args> {
    // THE READ (Promise-read model): the bare call is the awaitable, coalesced load; it also subscribes
    // the calling reactive context, so `{await fn()}` / `{#await fn()}` re-await on invalidate. Use
    // `.live()` for the non-blocking `T | undefined` snapshot.
    (...args: RpcInvokeArgs<Args>): Promise<T>
    // Run `handler` whenever this slot's value changes; returns a dispose function. Reactive probe.
    watch(args: Args, handler: (value: T | undefined) => void): () => void
    // THE BARE CALL, ENCODED — a `Response` instead of the decoded value, and nothing else different
    // (rpc-core call surface). On the SERVER that is the same chained, coalesced, deadline-bounded read
    // `fn(args)` makes, encoded the way the wire would encode it. In the BROWSER it is the same request
    // the bare call makes, handed back undecoded — the wire's own status and headers, which is what a
    // caller reaching for `.raw` there is reaching for. `init` describes that request on both sides.
    raw(args: Args, init?: RequestInit): Promise<Response>
    // Narrow a caught value to this RPC's typed error by name (`fn.isError(e, "RateLimited")`).
    isError(e: unknown, name: string): boolean
    // Mutate the retained value in place (value-form or updater-form). On a `shared`
    // read this broadcasts (value-form directly, updater-form resolves server-side then broadcasts).
    publish(args: Args, next: T | ((current: T | undefined) => T)): void
    // SERVER-ONLY broadcast seam (rpc-core §8, PR2). `createApp` calls this on a `shared` read to bind
    // the memo's transport-free `notify` sink to a channel publish. Transport stays out of makeRpc —
    // the sink is supplied by createApp (which alone knows the route NAME). A no-op until bound, and
    // permanently inert on the browser proxy — present on both sides so the surface stays one shape.
    bindBroadcast(sink: MemoNotify): void
}

// The mutation call surface: identical probes/verbs, widened call (args in the body, `FormData` legal).
export interface MutationCallSurface<Args, T> extends RpcCallSurface<Args, T> {
    (...args: MutationInvokeArgs<Args>): Promise<T>
}
