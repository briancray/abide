import type { ClientFlags } from './ClientFlags.ts'
import type { ErrorSpec } from './ErrorSpec.ts'
import type { HttpMethod } from './HttpMethod.ts'
import type { Outbox } from './Outbox.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'
import type { RemoteCallable } from './RemoteCallable.ts'
import type { RpcError } from './RpcError.ts'
import type { RpcErrorGuard } from './RpcErrorGuard.ts'
import type { SmartReadOptions } from './SmartReadOptions.ts'

/*
Remote function reference produced by GET/POST/... inside an `$rpc/**`
module and consumed by rpc dispatch, cache(), SSR auto-hydration, and
direct calls. Same callable signature on server and client — the bundler
swaps the implementation for browser builds.

The plain call resolves to the decoded body shape (sniffed from
Content-Type) and throws HttpError on non-2xx. `.raw` is a sibling
RemoteFunction whose call resolves to the underlying Response — same
method, same url, same args, no decode. Pass `fn.raw` to cache() to
memoise raw Responses against the same cache key as `fn` (both share one
stored entry — the decode just happens on the way out for callers of
`fn`). A streaming handler (jsonl()/sse()) makes the bare call return a
`NamedAsyncIterable<Frame>` directly (the iterable IS the value) — consume it with
`for await (… of fn(args))` or `state(fn(args))`; there is no `.stream()`, and
`await`-ing a streaming call is a compile error. For sustained broadcast /
pub-sub use the `abide/server/socket` primitive — HTTP rpc isn't the place for
long-lived multi-publisher subscriptions.
`.fetch(req)` is the framework's request-dispatch entry point — used by
the router to invoke the handler from an incoming HTTP request, not
for user code.
`crossOrigin` (server-side only, set via the rpc's opts) exempts a
mutating rpc from the router's same-origin CSRF gate, accepting browser
requests whose Origin doesn't match the app's own host.
*/
/*
A body rpc (POST/PUT/PATCH) also accepts a FormData in place of typed args:
buildRpcRequest ships it as a multipart body and the server splits text fields
into args (still schema-validated) and File parts into files(). FormData is
stringly-typed, so this is the upload escape hatch — typed object args remain
the default for everything else.
*/
export type RemoteFunction<
    Args,
    Return,
    Errors extends ErrorSpec = Record<never, never>,
    Durable extends boolean = false,
> = RemoteCallable<Args, Return, SmartReadOptions> & {
    readonly method: HttpMethod
    readonly url: string
    readonly clients: ClientFlags
    readonly crossOrigin?: boolean
    readonly raw: RawRemoteFunction<Args>
    fetch(request: Request): Promise<Response>
    /* Type-guard a caught error against this rpc's declared `errors` (plus the framework
       `'validation'` / `'queued'`): narrows `.kind` and, for a known kind, `.data` — the
       per-rpc replacement for a global guard, since the error name → data type mapping
       lives in the rpc's own spec. */
    readonly isError: RpcErrorGuard<Errors>
    /* Pre-bound selector sugar: `fn.pending(args?)` ≡ `pending(fn, args?)`, and likewise for
       refreshing / refresh / peek — the rpc is the leading selector, bound in. The argument is
       this rpc's typed `Args` (the by-args refinement); tags / cross-cutting selection stay on
       the globals. The bare call `fn(args, opts)` IS the cached read (was `fn.cache`), and
       `refresh(args?)` refetches keeping the stale value visible (was `invalidate`, which
       dropped). `peek(args?)` reads the retained value synchronously (a streaming rpc peeks its
       latest frame). `patch` is fetch-only, so it is omitted for a streaming rpc (a stream isn't
       a memoized value) via the intersection below. */
    pending(args?: Args): boolean
    refreshing(args?: Args): boolean
    refresh(args?: Args): void
    peek(args?: Args): ([Return] extends [AsyncIterable<infer Frame>] ? Frame : Return) | undefined
    /* This rpc's last error, typed off `Errors` (a discriminated union already narrowed on
       `.kind`/`.data`). `args` scopes to one call; omitted aggregates the most-recent across
       this rpc. Truthiness is the "isError" check. Instance-only — no bare global (it would
       shadow the server `error()` thrower). Reads the rpc error registry captured at the call
       boundary; the cache is untouched. */
    error(args?: Args): RpcError<Errors> | undefined
    /* Client-only reaction sugar: `fn.watch(handler)` / `fn.watch(args, handler)` ≡
       `watch(fn, …)` — runs the smart read reactively and pipes each resolved value to the
       handler, returning a scope-tied disposer. Reaction is a client concern (`watch` is a ui
       primitive), so this is an inert no-op server-side; an author `fn.watch(…)` surviving the
       SSR effect-strip (which leaves member calls intact) is a safe no-op there. The real method
       is attached client-side by remoteProxy. */
    watch(handler: (value: Return) => void): () => void
    watch(args: Args, handler: (value: Return) => void): () => void
} /* `patch` is fetch-only: a streaming rpc has no single memoized value to mutate, so the
     method is present only when `Return` is not an AsyncIterable. Two signatures: with args
     (`patch(args, updater)`) and without (`patch(updater)` — every args-variant). Tuple-wrapped
     so the conditional doesn't distribute over a `never` Return (an error-only rpc). */ & ([
        Return,
    ] extends [AsyncIterable<unknown>]
        ? Record<never, never>
        : {
              patch(args: Args | undefined, updater: (current: Return) => Return): void
              patch(updater: (current: Return) => Return): void
          }) /* `outbox` presence follows the `outbox: true` opt: the mutating helper threads `Durable`
     into the return type so a DURABLE rpc's `.outbox` is the required queue face (no optional
     chain). A non-durable rpc keeps it optional — assignable to a durable one everywhere a
     bare `RemoteFunction<Args, Return>` slot (cache selectors, registries) is expected, since
     required→optional widens cleanly and no call site had to learn the `Durable` bit. */ &
    (Durable extends true ? { readonly outbox: Outbox<Args> } : { readonly outbox?: Outbox<Args> })
