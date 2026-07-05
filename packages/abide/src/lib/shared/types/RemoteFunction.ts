import type { CacheOptions } from './CacheOptions.ts'
import type { ClientFlags } from './ClientFlags.ts'
import type { ErrorSpec } from './ErrorSpec.ts'
import type { HttpMethod } from './HttpMethod.ts'
import type { Outbox } from './Outbox.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'
import type { RemoteCallable } from './RemoteCallable.ts'
import type { RpcError } from './RpcError.ts'
import type { RpcErrorGuard } from './RpcErrorGuard.ts'
import type { Subscribable } from './Subscribable.ts'

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
`fn`). `.stream(args)` returns an iterable view of the Response body:
SSE / JSONL handlers yield each frame; non-streaming handlers yield the
decoded body once then complete. The result is a Subscribable, so it
can be passed to tail() and shared across reactive consumers.
For sustained broadcast / pub-sub use the `abide/server/socket` primitive —
HTTP rpc isn't the place for long-lived multi-publisher subscriptions.
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
> = RemoteCallable<Args, Return> & {
    readonly method: HttpMethod
    readonly url: string
    readonly clients: ClientFlags
    readonly crossOrigin?: boolean
    readonly raw: RawRemoteFunction<Args>
    stream(args?: Args | FormData): Subscribable<Return>
    fetch(request: Request): Promise<Response>
    /* Type-guard a caught error against this rpc's declared `errors` (plus the framework
       `'validation'` / `'queued'`): narrows `.kind` and, for a known kind, `.data` — the
       per-rpc replacement for a global guard, since the error name → data type mapping
       lives in the rpc's own spec. */
    readonly isError: RpcErrorGuard<Errors>
    /* Pre-bound selector sugar: `fn.pending(args?)` ≡ `pending(fn, args?)`, and likewise for
       refreshing / invalidate — the rpc is the leading selector, bound in. The argument is this
       rpc's typed `Args` (the by-args refinement); tags / cross-cutting selection stay on the
       globals. `cache(args?, options?)` is the direct read-through call for those args
       (≡ `cache(fn, args, options)`) — returns the cached promise. */
    pending(args?: Args): boolean
    refreshing(args?: Args): boolean
    invalidate(args?: Args): void
    cache(args?: Args, options?: CacheOptions): Promise<Return>
    /* This rpc's last error, typed off `Errors` (a discriminated union already narrowed on
       `.kind`/`.data`). `args` scopes to one call; omitted aggregates the most-recent across
       this rpc. Truthiness is the "isError" check. Instance-only — no bare global (it would
       shadow the server `error()` thrower). Reads the rpc error registry captured at the call
       boundary; the cache is untouched. */
    error(args?: Args): RpcError<Errors> | undefined
} /* `outbox` presence follows the `outbox: true` opt: the mutating helper threads `Durable`
     into the return type so a DURABLE rpc's `.outbox` is the required queue face (no optional
     chain). A non-durable rpc keeps it optional — assignable to a durable one everywhere a
     bare `RemoteFunction<Args, Return>` slot (cache selectors, registries) is expected, since
     required→optional widens cleanly and no call site had to learn the `Durable` bit. */ & (Durable extends true
        ? { readonly outbox: Outbox<Args> }
        : { readonly outbox?: Outbox<Args> })
