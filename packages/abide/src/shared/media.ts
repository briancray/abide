// 23.30, 23.31 — WHETHER THE DOCUMENT MATCHES A MEDIA QUERY. A browser answers with `matchMedia` and
// its `change` event; a server has no viewport, so it answers false, and a region the browser
// chooses otherwise at hydration is 41.24's.
//
// `online`'s shape, per query: a body rather than a value where there is a window, so a test
// process's server render reads 23.31's answer from the same module (22.11).
//
// 23.32 — ONE VALUE AND ONE LISTENER PER QUERY TEXT, made where the query is first asked: a
// component asking per instance would otherwise add a listener per mount and never remove one.
// Nothing runs at load, so an app that never names `media` does not ship a listener.

import { isServer } from './isServer.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'

const queries = new Map<string, Reactive<boolean>>()

/** Whether the document matches `query`, as a `Reactive<boolean>`. */
export function media(query: string): Reactive<boolean> {
    const held = queries.get(query)
    if (held !== undefined) return held
    let value: Reactive<boolean>
    if (typeof window === 'undefined') value = ambient<boolean>(false)
    else {
        const list = matchMedia(query)
        const followed = ambient<boolean>(() => !isServer() && list.matches)
        list.addEventListener('change', (event) => followed.set(event.matches))
        value = followed
    }
    queries.set(query, value)
    return value
}
