// 23.1 — WHERE WE ARE, as four values rather than one over a composite, so a reader of `params`
// does not wake for a hash change and a progress bar reading `navigating` does not wake for either.
//
// FILLED BY WHOEVER RESOLVES THE ADDRESS: the client router per navigation, and a server's page lane
// per request — where a module-level `reactive` is already one instance per request (11.32).

import type { Params } from './matchRoute.ts'
import { ambient } from './reactive/index.ts'

export const route = {
    url: ambient<URL>(),
    params: ambient<Params>(),
    // 23.6 — the resolution path: the literal the address resolved to, `/invoices/[id]`.
    name: ambient<string>(),
    navigating: ambient(false),
}

// 23.2 — ONE `URL` PER NAVIGATION, built here as the route resolves, so a reader holding the last
// one is not handed a value that moved under it.
export function arrive(at: string, pattern: string, params: Params): void {
    route.url.set(new URL(at))
    route.params.set(params)
    route.name.set(pattern)
}
