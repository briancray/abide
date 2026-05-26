import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { createRemoteFunction } from '../../shared/createRemoteFunction.ts'
import type { HttpVerb } from './types/HttpVerb.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { RemoteHandler } from './types/RemoteHandler.ts'
import type { StandardSchemaV1 } from './types/StandardSchemaV1.ts'
import { parseArgs } from './parseArgs.ts'
import { requestContext } from '../runtime/requestContext.ts'

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
`src/server/rpc/`, with `/rpc/` prefix) are threaded into defineVerb.

The plain call (`fn(args)`) resolves to the Content-Type-decoded body;
non-2xx responses throw HttpError. `.raw(args)` returns the underlying
Response for callers that need status/headers/body streaming.
`.fetch(req)` is the dispatch hook the framework's router uses to
invoke the handler from an incoming HTTP request (with args parsed off
the Request via parseArgs).

Every raw invocation records the synthesized Request against the returned
promise so cache() can stash it on the entry without re-building.
*/
export function defineVerb<Args, Return>(
    method: HttpVerb,
    url: string,
    handler: RemoteHandler<Args, Return>,
    opts?: { schema?: StandardSchemaV1 },
): RemoteFunction<Args, Return> {
    const schema = opts?.schema

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

    function buildRequest(args: Args | undefined): Request {
        const store = requestContext.getStore()
        const baseUrl = store ? store.url.href : 'http://localhost/'
        return buildRpcRequest({ method, url, args, baseUrl, headers: inheritHeaders() })
    }

    function runHandler(args: Args | undefined): Promise<Response> {
        try {
            return Promise.resolve(handler(args as Args)) as Promise<Response>
        } catch (error) {
            return Promise.reject(error)
        }
    }

    async function validateThenHandle(args: Args | undefined): Promise<Response> {
        const result = await schema!['~standard'].validate(args)
        if (result.issues) {
            return new Response(JSON.stringify({ issues: result.issues }), {
                status: 422,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': NO_STORE,
                },
            })
        }
        return runHandler(result.value as Args)
    }

    /*
    Handler bodies may throw synchronously (e.g. an `assert(...)` at the
    top of the function). Wrap the call so those throws are reflected as
    rejections — otherwise an SSR caller's `await` short-circuits past
    the cache layer's snapshot serialization and the error escapes the
    request boundary. When a Standard Schema is attached, args are
    validated before the handler runs; failures short-circuit into a 422
    Response carrying the schema's issues so callers can decode them off
    the HttpError.
    */
    function invoke(_request: Request, args: Args | undefined): Promise<Response> {
        return schema ? validateThenHandle(args) : runHandler(args)
    }

    return createRemoteFunction<Args, Return>({
        method,
        url,
        buildRequest,
        invoke,
        parseArgsForFetch: (request) => parseArgs(method, request) as Promise<Args | undefined>,
    })
}
