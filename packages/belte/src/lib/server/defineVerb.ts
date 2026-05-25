import { buildRouteRequest } from '../shared/buildRouteRequest.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import { streamResponse } from '../shared/streamResponse.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RawRemoteFunction, RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import { parseArgs } from './parseArgs.ts'
import { requestContext } from './requestContext.ts'

/*
Headers forwarded from the inbound request onto in-process synthetic
Requests when a remote handler is invoked from server-side rendering. Lets
handlers read the caller's cookies/authorization without per-call wiring.
*/
const FORWARDED_HEADERS = [
    'cookie',
    'authorization',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
]

/*
Builds a RemoteFunction from an HTTP verb + RPC URL + handler. The bundler
rewrites every `export const VERB = handler(fn)` inside an `$route/**` module
so the verb (from the export name) and the URL (from the file path under
`src/route/`, with `/route/` prefix) are threaded into defineVerb.

The plain call (`fn(args)`) resolves to the Content-Type-decoded body;
non-2xx responses throw HttpError. `.raw(args)` returns the underlying
Response for callers that need status/headers/streaming. `.fetch(req)` is
the dispatch hook the framework's router uses to invoke the handler from
an incoming HTTP request (with args parsed off the Request via parseArgs).

Every raw invocation records the synthesized Request against the returned
promise so cache() can stash it on the entry without re-building.
*/
export function defineVerb<Args, Return>(
    method: HttpVerb,
    url: string,
    handler: RemoteHandler<Args, Return>,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        const store = requestContext.getStore()
        const baseUrl = store ? store.url.href : 'http://localhost/'
        return buildRouteRequest({ method, url, args, baseUrl, headers: inheritHeaders() })
    }

    /*
    Copies session-shaped headers from the inbound request onto the synthetic
    Request used for in-process invocation. Without this, an in-process call
    from SSR can't see the caller's cookies/authorization — silently
    differing from a network-shaped call from the client.
    */
    function inheritHeaders(): Headers {
        const headers = new Headers()
        const store = requestContext.getStore()
        if (!store) {
            return headers
        }
        for (const name of FORWARDED_HEADERS) {
            const value = store.req.headers.get(name)
            if (value) {
                headers.set(name, value)
            }
        }
        return headers
    }

    function invoke(request: Request, args: Args | undefined): Promise<Response> {
        /*
        Handler bodies may throw synchronously (e.g. an `assert(...)` at the
        top of the function). Wrap the call so those throws are reflected as
        rejections — otherwise an SSR caller's `await` short-circuits past
        the cache layer's snapshot serialization and the error escapes the
        request boundary.
        */
        let promise: Promise<Response>
        try {
            promise = Promise.resolve(handler(args as Args)) as Promise<Response>
        } catch (error) {
            promise = Promise.reject(error)
        }
        recordRemoteMeta(promise, request)
        return promise
    }

    function rawCall(args: Args): Promise<Response> {
        const request = buildRequest(args)
        return invoke(request, args)
    }
    rawCall.method = method
    rawCall.url = url
    const raw = rawCall as RawRemoteFunction<Args>

    function callable(args: Args): Promise<Return> {
        return raw(args).then(decodeResponse) as Promise<Return>
    }

    callable.method = method
    callable.url = url
    callable.raw = raw
    callable.stream = (args: Args): AsyncIterable<Return> => {
        return streamResponse(rawCall(args)) as AsyncIterable<Return>
    }
    callable.fetch = async (request: Request): Promise<Response> => {
        const args = (await parseArgs(method, request)) as Args | undefined
        return invoke(request, args)
    }
    return callable as RemoteFunction<Args, Return>
}
