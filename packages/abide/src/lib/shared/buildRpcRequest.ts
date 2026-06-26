import { carriesBodyArgs } from './carriesBodyArgs.ts'
import { encodeRefJson } from './encodeRefJson.ts'
import { queryStringFromArgs } from './queryStringFromArgs.ts'
import { REF_JSON_HEADER } from './REF_JSON_HEADER.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

/*
Builds the Request a rpc helper uses to invoke its handler. Same shape on
both sides (server defineRpc + client remoteProxy) so the cache key
derivation and SSR snapshot round-trip identically. $rpc URLs are flat
(no `:name` segments): GET/DELETE/HEAD serialise args onto the query
string; POST/PUT/PATCH send them as application/json.

`baseUrl` provides the origin needed by the Request constructor — on the
server it's the inbound request's URL (so handlers reading `request.url` see
the caller's host), in the browser it's window.location. `headers` lets the
server pre-populate the synthetic Request with forwarded session headers;
the client passes nothing.
*/
export function buildRpcRequest({
    method,
    url,
    args,
    baseUrl,
    headers,
}: {
    method: HttpMethod
    url: string
    args: unknown
    baseUrl: string
    headers?: Headers
}): Request {
    const requestHeaders = headers ?? new Headers()
    if (!carriesBodyArgs(method)) {
        const target = appendQuery(method, url, args)
        return new Request(new URL(target, baseUrl).href, { method, headers: requestHeaders })
    }
    if (args === undefined) {
        return new Request(new URL(url, baseUrl).href, { method, headers: requestHeaders })
    }
    /*
    A FormData body ships as-is: the Request constructor sets its own
    `multipart/form-data` content-type with a boundary, so the server's
    parseArgs splits text fields into args and File parts into files().
    Setting the header by hand would omit the boundary and break parsing.
    */
    if (args instanceof FormData) {
        return new Request(new URL(url, baseUrl).href, {
            method,
            headers: requestHeaders,
            body: args,
        })
    }
    /* ref-json (still valid JSON, so the content-type holds) so an arg graph with
       cycles or shared back-references reaches the handler instead of throwing here.
       The REF_JSON_HEADER flags the encoding so parseArgs decodes it with the same
       codec; a non-abide client omits it and parseArgs reads plain JSON.parse. */
    requestHeaders.set('content-type', 'application/json')
    requestHeaders.set(REF_JSON_HEADER, '1')
    return new Request(new URL(url, baseUrl).href, {
        method,
        headers: requestHeaders,
        body: encodeRefJson(args),
    })
}

function appendQuery(method: HttpMethod, url: string, args: unknown): string {
    if (args === undefined) {
        return url
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        const got = Array.isArray(args) ? 'array' : typeof args
        throw new Error(`[abide] ${method} ${url} args must be a plain object — got ${got}`)
    }
    const suffix = queryStringFromArgs(args as Record<string, unknown>, false)
    return suffix === '' ? url : `${url}?${suffix}`
}
