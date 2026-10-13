// 16.18 — THE REQUEST A CALL IS, WRITTEN ONCE FOR BOTH ENDS. The browser's `wire` sends it, and the
// server writes the same request into a page's early-call script (41.20) — so the two have to agree
// to the byte, or the browser's call misses the request that was already started for it. `key` is
// that agreement: method, URL and body, which is what makes two requests the same one.
//
// A `GET` or `DELETE` carries its args in the URL, in `queryText`'s spelling, and a mutation in its
// body; 19.7 is where text becomes the declared type again. 16.9 — whatever the method, a parameter
// of the handler's route rides in the path, and the server puts it back among the args (16.65).

import { filledPath, parametersOf } from './filledPath.ts'
import { queryText } from './queryText.ts'
import { validationError } from './refuse.ts'
import type { Method } from './rpc.ts'

export type RpcRequest = {
    method: Method
    url: string
    /** The JSON body of a mutation, or `undefined` where the args ride in the URL. */
    body: string | undefined
    /** What `fetch` is handed: the method, the JSON content-type beside a body, and `no-cache`. */
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

/** The request a call is: its URL, body, `fetch` init and the `key` both ends match it by. */
export function rpcRequest(
    method: Method,
    address: string,
    given: Record<string, unknown> | undefined,
): RpcRequest {
    let args = given
    let url = address
    let body: string | undefined
    // A route with parameters: they are written into the path and leave the args, so the query or
    // body never carries one twice (16.66). 15.8 — one no address carries (30.3, 30.19) is refused as
    // args a gate refused, so every caller answers it as the wire answers a 422.
    if (address.includes('[')) {
        const params = given ?? {}
        url = filledPath(address, params, address, pathRefusal)
        const inPath = parametersOf(address)
        let rest: Record<string, unknown> | undefined
        for (const name in params) {
            if (inPath.has(name)) continue
            rest ??= {}
            rest[name] = params[name]
        }
        args = rest
    }
    if (argsInURL(method)) {
        if (args !== undefined) {
            let text = queryText(args)
            // AN EMPTY LIST IS ITS NAME WITH NO `=`, which no text value spells — `tags=` is the
            // one-member list `['']` — so 19.7 reads it back as `[]` rather than losing the member.
            for (const name in args) {
                const value = args[name]
                if (!Array.isArray(value) || value.length !== 0) continue
                const bare = bareName(name)
                text = text === '' ? bare : `${text}&${bare}`
            }
            if (text !== '') url = `${url}?${text}`
        }
    } else if (args !== undefined) body = JSON.stringify(args)
    // 18.14 — A COPY IS ITS OWN CACHE and keeps its own `max-age`. What it asks the server is asked
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

/** 15.8 — a parameter no address carries, refused as args a gate refused. */
export function pathRefusal(name: string, message: string): unknown {
    return validationError<Record<string, unknown>>({ [name]: [message] })
}

/** A query member's name in the encoding `URLSearchParams` gives it, without its `=`. */
export function bareName(name: string): string {
    return new URLSearchParams([[name, '']]).toString().slice(0, -1)
}
