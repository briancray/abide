import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { Subscribable } from '../../../shared/types/Subscribable.ts'
import type { HttpVerb } from './HttpVerb.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'

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
can be passed to subscribe() and shared across reactive consumers.
For sustained broadcast / pub-sub use the `belte/server/socket` primitive —
HTTP rpc isn't the place for long-lived multi-publisher subscriptions.
`.fetch(req)` is the framework's request-dispatch entry point — used by
the router to invoke the handler from an incoming HTTP request, not
for user code.
*/
export type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
    readonly method: HttpVerb
    readonly url: string
    readonly clients: ClientFlags
    readonly raw: RawRemoteFunction<Args>
    stream(args?: Args): Subscribable<Return>
    fetch(request: Request): Promise<Response>
}
