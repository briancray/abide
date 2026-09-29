// 16.19 — THE REQUEST A CALL IS, WRITTEN ONCE FOR BOTH ENDS. The browser's `wire` sends it, and the
// server writes the same request into a page's early-call script (41.20) — so the two have to agree
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
    // What `fetch` is handed: the method, the JSON content-type beside a body, and `no-cache`.
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
            let text = queryText(args)
            // AN EMPTY LIST IS ITS NAME WITH NO `=`, which no text value spells — `tags=` is the
            // one-member list `['']` — so 19.8 reads it back as `[]` rather than losing the member.
            for (const name in args) {
                const value = args[name]
                if (!Array.isArray(value) || value.length !== 0) continue
                const bare = bareName(name)
                text = text === '' ? bare : `${text}&${bare}`
            }
            if (text !== '') url = `${address}?${text}`
        }
    } else if (args !== undefined) body = JSON.stringify(args)
    // 18.29 — A COPY IS ITS OWN CACHE and keeps its own `max-age`. What it asks the server is asked
    // because it went stale or was invalidated, and the browser's HTTP cache, which hears neither,
    // would answer it with the value it was dropping. `rpc.raw` is handed the same, under whatever
    // `init` its caller passes. `no-cache` rather than `no-store`: a `fetch` the app writes itself to
    // the same address still reads 21.8's `max-age`.
    const init: RequestInit =
        body === undefined
            ? { method, cache: 'no-cache' }
            : {
                  method,
                  cache: 'no-cache',
                  headers: { 'content-type': 'application/json' },
                  body,
              }
    return { method, url, body, init, key: `${method} ${url} ${body ?? ''}` }
}

// A query member's name in the encoding `URLSearchParams` gives it, without its `=`.
export function bareName(name: string): string {
    return new URLSearchParams([[name, '']]).toString().slice(0, -1)
}
