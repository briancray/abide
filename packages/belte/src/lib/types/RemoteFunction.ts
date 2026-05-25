import type { HttpVerb } from './HttpVerb.ts'

/*
Remote function reference produced by GET/POST/... inside an `$rpc/**`
module and consumed by route dispatch, cache(), SSR auto-hydration, and
direct calls. Same callable signature on server and client — the bundler
swaps the implementation for browser builds.

The plain call resolves to the decoded body shape (sniffed from
Content-Type) and throws HttpError on non-2xx. `.raw` is a sibling
RemoteFunction whose call resolves to the underlying Response — same
method, same url, same args, no decode. Pass `fn.raw` to cache() to memoise
raw Responses against the same cache key as `fn` (both share one stored
entry — the decode just happens on the way out for callers of `fn`).
`.stream(args)` returns an AsyncIterable<Frame> that yields each parsed
frame for SSE/JSONL handlers, or yields once for a one-shot handler;
use it with `for await` to iterate without going through the shared
subscribe() registry. `.fetch(req)` is the framework's request-dispatch
entry point — used by the router to invoke the handler from an incoming
HTTP request, not for user code.
*/
export type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
    readonly method: HttpVerb
    readonly url: string
    readonly raw: RawRemoteFunction<Args>
    stream(args: Args): AsyncIterable<Return>
    fetch(request: Request): Promise<Response>
}

export type RawRemoteFunction<Args> = ((args: Args) => Promise<Response>) & {
    readonly method: HttpVerb
    readonly url: string
}
