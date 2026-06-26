import type { ClientFlags } from './ClientFlags.ts'
import type { HttpMethod } from './HttpMethod.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'
import type { RemoteCallable } from './RemoteCallable.ts'
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
`crossOrigin` (server-side only, set via the verb's opts) exempts a
mutating verb from the router's same-origin CSRF gate, accepting browser
requests whose Origin doesn't match the app's own host.
*/
/*
A body verb (POST/PUT/PATCH) also accepts a FormData in place of typed args:
buildRpcRequest ships it as a multipart body and the server splits text fields
into args (still schema-validated) and File parts into files(). FormData is
stringly-typed, so this is the upload escape hatch — typed object args remain
the default for everything else.
*/
export type RemoteFunction<Args, Return> = RemoteCallable<Args, Return> & {
    readonly method: HttpMethod
    readonly url: string
    readonly clients: ClientFlags
    readonly crossOrigin?: boolean
    readonly raw: RawRemoteFunction<Args>
    stream(args?: Args | FormData): Subscribable<Return>
    fetch(request: Request): Promise<Response>
}
