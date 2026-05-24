import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { recordRemoteMeta } from '../shared/remoteMeta.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'
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
rewrites every `export const VERB = handler(fn)` inside an `$rpc/**` module
so the verb (from the export name) and the URL (from the file path under
`src/rpc/`, with `/rpc/` prefix) are threaded into defineVerb. Calling the
function invokes the handler directly with a synthesized Request (built
from the args); calling `.fetch(req, pathParams)` lets a caller hand in a
Request + matched path params and the wrapper merges body/query/path into
the args per parseArgs.

Every call records the synthesized Request against the returned promise so
cache() can stash it on the entry without re-building.
*/
export function defineVerb<Args, Return>(
    method: HttpVerb,
    url: string,
    handler: RemoteHandler<Args, Return>,
): RemoteFunction<Args, Return> {
    function buildRequest(args: Args | undefined): Request {
        const store = requestContext.getStore()
        const baseUrl = store ? store.url.href : 'http://localhost/'
        return buildRpcRequest({ method, url, args, baseUrl, headers: inheritHeaders() })
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

    function invoke(request: Request, args: Args | undefined): Promise<RemoteResponse<Return>> {
        /*
        Handler bodies may throw synchronously (e.g. an `assert(...)` at the
        top of the function). Wrap the call so those throws are reflected as
        rejections — otherwise an SSR caller's `await` short-circuits past
        the cache layer's snapshot serialization and the error escapes the
        request boundary.
        */
        let promise: Promise<RemoteResponse<Return>>
        try {
            promise = Promise.resolve(handler(args as Args, request)) as Promise<
                RemoteResponse<Return>
            >
        } catch (error) {
            promise = Promise.reject(error) as Promise<RemoteResponse<Return>>
        }
        recordRemoteMeta(promise, request)
        return promise
    }

    function callable(args: Args): Promise<RemoteResponse<Return>> {
        const request = buildRequest(args)
        return invoke(request, args)
    }

    callable.method = method
    callable.url = url
    callable.fetch = async (
        request: Request,
        pathParams?: Record<string, string>,
    ): Promise<RemoteResponse<Return>> => {
        const args = (await parseArgs(method, request, pathParams)) as Args | undefined
        return invoke(request, args)
    }
    return callable as RemoteFunction<Args, Return>
}
