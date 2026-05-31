import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { carriesBodyArgs } from './carriesBodyArgs.ts'

/*
Builds the Request a verb helper uses to invoke its handler. Same shape on
both sides (server defineVerb + client remoteProxy) so the cache key
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
    method: HttpVerb
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
    requestHeaders.set('content-type', 'application/json')
    return new Request(new URL(url, baseUrl).href, {
        method,
        headers: requestHeaders,
        body: JSON.stringify(args),
    })
}

function appendQuery(method: HttpVerb, url: string, args: unknown): string {
    if (args === undefined) {
        return url
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        const got = Array.isArray(args) ? 'array' : typeof args
        throw new Error(`[belte] ${method} ${url} args must be a plain object — got ${got}`)
    }
    const entries = Object.entries(args as Record<string, unknown>).filter(
        ([, value]) => value !== undefined,
    )
    if (entries.length === 0) {
        return url
    }
    const suffix = new URLSearchParams(entries as Array<[string, string]>).toString()
    return suffix === '' ? url : `${url}?${suffix}`
}
