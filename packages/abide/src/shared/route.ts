// 23.1 — WHERE WE ARE, as five values rather than one over a composite, so a reader of `params`
// does not wake for a hash change and a progress bar reading `navigating` does not wake for either.
//
// FILLED BY WHOEVER RESOLVES THE ADDRESS: the client router per navigation, and a server's page lane
// per request — where a module-level `reactive` is already one instance per request (11.32).

import type { Params } from './matchRoute.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { type QueryDefaults, type QueryOf, routeQuery } from './routeQuery.ts'

/**
 * The current address: its `url`, `params`, pattern `name`, its `index` in this document's history,
 * whether it is `navigating`, and its `query` read through a set of defaults.
 */
export const route = {
    url: ambient<URL>(),
    params: ambient<Params>(),
    /** 23.6 — the resolution path: the literal the address resolved to, `/invoices/[id]`. */
    name: ambient<string>(),
    /**
     * 23.28, 23.29 — the entry's place in the history this app's router wrote: 0 where a document
     * load arrived, and one past the entry it was pushed from.
     */
    index: ambient(0),
    navigating: ambient(false),
    /**
     * 30.41 — the query as one value of the defaults' shape, written by navigating. A FUNCTION, not
     * a sixth value: each caller names the members it owns (30.45).
     */
    query<Defaults extends QueryDefaults>(
        defaults: Defaults,
    ): Reactive<QueryOf<Defaults>, Partial<QueryOf<Defaults>>> {
        return routeQuery(route.url, defaults)
    },
}

/**
 * Sets `route`'s url, params, name and index to an address just resolved.
 *
 * 23.2 — ONE `URL` PER NAVIGATION, built here as the route resolves, so a reader holding the last
 * one is not handed a value that moved under it.
 */
export function arrive(
    at: string,
    pattern: string,
    params: Params,
    index: number,
): void {
    route.url.set(new URL(at))
    route.params.set(params)
    route.name.set(pattern)
    route.index.set(index)
}
