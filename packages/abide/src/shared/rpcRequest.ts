// 16.19 — THE REQUEST A CALL IS, WRITTEN ONCE FOR BOTH ENDS. The browser's `wire` sends it, and the
// server writes the same request into a page's early-call script (41.21) — so the two have to agree
// to the byte, or the browser's call misses the request that was already started for it. `key` is
// that agreement: method, URL and body, which is what makes two requests the same one.
//
// A `GET` or `DELETE` carries its args in the URL, in `queryText`'s spelling, and a mutation in its
// body; 19.8 is where text becomes the declared type again.

import { queryText } from './queryText.ts'
import type { Method } from './rpc.ts'

export type RpcRequest = {
    method: Method
    url: string
    // The JSON body of a mutation, or `undefined` where the args ride in the URL.
    body: string | undefined
    // What `fetch` is handed: the method, and the JSON content-type beside a body.
    init: RequestInit
    key: string
}

// The half of 16.19 both ends read: which methods carry their args in the URL.
export function argsInURL(method: Method): boolean {
    return method === 'GET' || method === 'DELETE'
}

export function rpcRequest(
    method: Method,
    address: string,
    args: Record<string, unknown> | undefined,
): RpcRequest {
    let url = address
    let body: string | undefined
    if (argsInURL(method)) {
        if (args !== undefined) {
            const text = queryText(args)
            if (text !== '') url = `${address}?${text}`
        }
    } else if (args !== undefined) body = JSON.stringify(args)
    const init: RequestInit =
        body === undefined
            ? { method }
            : { method, headers: { 'content-type': 'application/json' }, body }
    return { method, url, body, init, key: `${method} ${url} ${body ?? ''}` }
}
