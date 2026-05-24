import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'

/*
Client-side substitute for a verb-defined handler. The bundler emits one
call per verb export inside an `$rpc/**` module (GET / POST / …): server
target uses defineVerb (real handler), browser target uses remoteProxy
(fetch over the network). Both paths produce identical RemoteFunction
shapes and identical WeakMap metadata so cache() works the same on either
side.

`url` is the flat rpc route. Args go in the JSON body (POST/PUT/PATCH) or
the query string (GET/DELETE/HEAD).
*/
export function remoteProxy<Args, Return>(
    method: HttpVerb,
    url: string,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        return buildRpcRequest({ method, url, args, baseUrl: window.location.href })
    }

    function dispatch(request: Request): Promise<RemoteResponse<Return>> {
        const promise = fetch(request) as Promise<RemoteResponse<Return>>
        recordRemoteMeta(promise, request)
        return promise
    }

    function callable(args: Args): Promise<RemoteResponse<Return>> {
        return dispatch(buildRequest(args))
    }

    callable.method = method
    callable.url = url
    callable.fetch = (request: Request): Promise<RemoteResponse<Return>> => {
        return dispatch(request)
    }
    return callable as RemoteFunction<Args, Return>
}
