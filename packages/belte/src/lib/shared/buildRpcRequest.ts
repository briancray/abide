import { substitutePathParams } from './substitutePathParams.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'

/*
Builds the Request a verb helper uses to invoke its handler. Same shape on
both sides (server defineVerb + client remoteProxy) so the cache key
derivation and SSR snapshot round-trip identically. GET/DELETE/HEAD push
leftover args onto the query string; the body verbs serialise them as
application/json. Path params are substituted first via substitutePathParams.

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
    const { url: pathUrl, leftover } = substitutePathParams(method, url, args)
    const hdrs = headers ?? new Headers()
    if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
        const target = appendQuery(pathUrl, leftover)
        return new Request(new URL(target, baseUrl).href, { method, headers: hdrs })
    }
    if (leftover === undefined) {
        return new Request(new URL(pathUrl, baseUrl).href, { method, headers: hdrs })
    }
    hdrs.set('content-type', 'application/json')
    return new Request(new URL(pathUrl, baseUrl).href, {
        method,
        headers: hdrs,
        body: JSON.stringify(leftover),
    })
}

function appendQuery(url: string, args: Record<string, unknown> | undefined): string {
    if (!args) {
        return url
    }
    const entries = Object.entries(args).filter(([, value]) => value !== undefined)
    if (entries.length === 0) {
        return url
    }
    const suffix = new URLSearchParams(entries as Array<[string, string]>).toString()
    return suffix === '' ? url : `${url}?${suffix}`
}
