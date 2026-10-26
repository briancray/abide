// 16.18 — THE REQUEST A CALL IS, WRITTEN ONCE FOR BOTH ENDS. The browser's `wire` sends it, and the
// server writes the same request into a page's early-call script (41.20) — so the two have to agree
// to the byte, or the browser's call misses the request that was already started for it. `key` is
// that agreement: method, URL and body, which is what makes two requests the same one.
//
// A `GET` or `DELETE` carries its args in the URL, in `queryText`'s spelling (30.28), and a mutation
// in its body; 19.7 is where text becomes the declared type again. 16.9 — whatever the method, a
// parameter of the handler's route rides in the path, and the server puts it back among the args
// (16.65).

import { HandlerRoute } from './HandlerRoute.ts'
import { queryText } from './queryText.ts'
import type { Method } from './rpc.ts'

export type RpcRequest = {
    method: Method
    url: string
    /** The JSON body of a mutation, or `undefined` where the args ride in the URL. */
    body: string | undefined
    /** What `fetch` is handed: the method, the JSON content-type beside a body, and its `cache`. */
    init: RequestInit
    key: string
}

/**
 * Whether a method carries its args in the URL.
 *
 * The half of 16.18 both ends read.
 */
export function argsInURL(method: Method): boolean {
    return method === 'GET' || method === 'DELETE'
}

/**
 * The request a call is: its URL, body, `fetch` init and the `key` both ends match it by.
 *
 * `route` is the handler's, compiled where the caller holds one; an address is compiled here.
 */
export function rpcRequest(
    method: Method,
    route: HandlerRoute | string,
    given: Record<string, unknown> | undefined,
    cache: RequestCache = 'no-cache',
): RpcRequest {
    const { path, rest } = (
        typeof route === 'string' ? new HandlerRoute(route) : route
    ).split(given)
    let url = path
    let body: string | undefined
    if (argsInURL(method)) {
        const text = rest === undefined ? '' : queryText(rest)
        if (text !== '') url = `${url}?${text}`
    } else if (rest !== undefined) body = JSON.stringify(rest)
    // 18.14 — A COPY IS ITS OWN CACHE and keeps its own `max-age`. What it asks the server once it
    // holds an answer is asked because it went stale, was invalidated or refreshed, and a cache
    // below it, which hears none of the three, would answer it with the value it was dropping — so
    // `no-cache`. A page's first load in a page the worker answers is the browser's to switch to
    // `force-cache` (16.80), where a kept copy is what opens the page without the network (45.18);
    // the outbox's send asks `no-store`. `rpc.raw` is handed `no-cache`, under whatever `init` its
    // caller passes. `no-cache` rather than `no-store`: a `fetch` the app writes itself to the same
    // address still reads 21.8's `max-age`.
    const init: RequestInit =
        body === undefined
            ? { method, cache }
            : {
                  method,
                  cache,
                  headers: { 'content-type': 'application/json' },
                  body,
              }
    return { method, url, body, init, key: `${method} ${url} ${body ?? ''}` }
}
