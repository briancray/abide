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

// A read-call argument tuple. A ZERO-arg read infers `Args = unknown`, which makes the argument
// OPTIONAL so a bare `fn()` type-checks; a declared arg stays REQUIRED because `Args` is then a
// concrete shape — exactly the discriminator between "no declared input" and "declared input".
export type RpcCallArgs<Args> = unknown extends Args ? [args?: Args] : [args: Args]

// A mutation-call argument tuple — same zero-arg discriminator as `RpcCallArgs`, but a mutation also
// accepts a `FormData` in the arg slot. A ZERO-arg mutation (`POST(() => …)`) makes the argument
// OPTIONAL so a bare `fn()` type-checks (parity with a zero-arg read); a declared arg stays REQUIRED.
export type MutationCallArgs<Args> = unknown extends Args
    ? [args?: Args | FormData]
    : [args: Args | FormData]

export interface RpcCallSurface<Args, T> {
    // THE READ (Promise-read model): the bare call is the awaitable, coalesced load; it also subscribes
    // the calling reactive context, so `{await fn()}` / `{#await fn()}` re-await on invalidate. Use
    // `.peek()` for the non-blocking `T | undefined` snapshot.
    (...args: RpcCallArgs<Args>): Promise<T>
    // Reactive peek: subscribes, kicks a coalesced load when cold, returns value or undefined.
    peek(...args: RpcCallArgs<Args>): T | undefined
    pending(...args: RpcCallArgs<Args>): boolean
    // Revalidating over a retained value (distinct from first-load `pending`). Reactive.
    refreshing(...args: RpcCallArgs<Args>): boolean
    error(...args: RpcCallArgs<Args>): unknown
    // Run `handler` whenever this slot's value changes; returns a dispose function. Reactive probe.
    watch(args: Args, handler: (value: T | undefined) => void): () => void
    // Raw `Response`, full bypass of the memo (rpc-core call surface): on the client a bare fetch to
    // `/__abide/rpc/<name>`; on the server the handler run wrapped in a JSON `Response` (or its own Response).
    raw(args: Args, init?: RequestInit): Promise<Response>
    // Narrow a caught value to this RPC's typed error by name (`fn.isError(e, "RateLimited")`).
    isError(e: unknown, name: string): boolean
    // Partial selector matches every superset slot (spec: partial-object match); mirrors `Memo`.
    refresh(args?: Partial<Args> | Args): void
    invalidate(args?: Partial<Args> | Args): void
    // Mutate the retained value in place (value-form or updater-form); mirrors `Memo`. On a `shared`
    // read this broadcasts (value-form directly, updater-form resolves server-side then broadcasts).
    publish(args: Args, next: T | ((current: T | undefined) => T)): void
    // §5 hydration: `snapshot()` records this read's resolved slots for the seed; `seed()` replays a
    // recorded (args, value) into the cache so the client resolves from cache instead of re-fetching.
    snapshot(): Array<{ args: Args; value: T }>
    seed(args: Args, value: T): void
    // §5 streaming hydration: install a warm stream slot from an SSR `{#for await}` handoff (a mode-A
    // array transcript, or a mode-B "prefix then resumed tail" AsyncIterable) so the client replays it with
    // no re-invoke and the chunk probes + refresh work.
    seedStream(
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): void
    // SERVER-ONLY broadcast seam (rpc-core §8, PR2). `createApp` calls this on a `shared` read to bind
    // the memo's transport-free `notify` sink to a channel publish. Transport stays out of makeRpc —
    // the sink is supplied by createApp (which alone knows the route NAME). A no-op until bound, and
    // permanently inert on the browser proxy — present on both sides so the surface stays one shape.
    bindBroadcast(sink: MemoNotify): void
}

// The mutation call surface: identical probes/verbs, widened call (args in the body, `FormData` legal).
export interface MutationCallSurface<Args, T> extends RpcCallSurface<Args, T> {
    (...args: MutationCallArgs<Args>): Promise<T>
}
