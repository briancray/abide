import { buildRouteRequest } from '../shared/buildRouteRequest.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import { streamResponse } from '../shared/streamResponse.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RawRemoteFunction, RemoteFunction } from '../types/RemoteFunction.ts'

/*
Client-side substitute for a verb-defined handler. The bundler emits one
call per verb export inside an `$route/**` module (GET / POST / …): server
target uses defineVerb (real handler), browser target uses remoteProxy
(fetch over the network). Both paths produce identical RemoteFunction
shapes and identical WeakMap metadata so cache() works the same on either
side.

`url` is the flat rpc route. Args go in the JSON body (POST/PUT/PATCH) or
the query string (GET/DELETE/HEAD). Plain `fn(args)` decodes the Response
by Content-Type and throws HttpError on non-2xx; `.raw(args)` is the
escape hatch that returns the Response untouched.
*/
export function remoteProxy<Args, Return>(
    method: HttpVerb,
    url: string,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        return buildRouteRequest({ method, url, args, baseUrl: window.location.href })
    }

    function dispatch(request: Request): Promise<Response> {
        const promise = fetch(request)
        recordRemoteMeta(promise, request)
        return promise
    }

    function rawCall(args: Args): Promise<Response> {
        return dispatch(buildRequest(args))
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
    callable.fetch = (request: Request): Promise<Response> => {
        return dispatch(request)
    }
    return callable as RemoteFunction<Args, Return>
}
