// 23.30, 23.31 — WHETHER THE DOCUMENT MATCHES A MEDIA QUERY. A browser answers with `matchMedia` and
// its `change` event; a server has no viewport, so it answers false, and hydration reads that
// answer too (41.32).
//
// `online`'s shape, per query: a body rather than a value where there is a window, so a test
// process's server render reads 23.31's answer from the same module (22.11).
//
// 23.32 — ONE VALUE AND ONE LISTENER PER QUERY TEXT, made where the query is first asked: a
// component asking per instance would otherwise add a listener per mount and never remove one.
// Nothing runs at load, so an app that never names `media` does not ship a listener.

import { isHydrating, standIn } from './hydrating.ts'
import { isServer } from './isServer.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { runInScope } from './reactive/scoping.ts'

const queries = new Map<string, Reactive<boolean>>()

/** Whether the document matches `query`, as a `Reactive<boolean>`. */
export function media(query: string): Reactive<boolean> {
    const held = queries.get(query)
    if (held !== undefined) return held
    let value: Reactive<boolean>
    if (typeof window === 'undefined') value = ambient<boolean>(false)
    else {
        const list = matchMedia(query)
        // 41.32 — the server's answer while the page hydrates, and the browser's after.
        // 23.30 — BUILT OUTSIDE EVERY REQUEST, wherever first asked: a test process's server render
        // asks inside one, and a value built there runs its body in that request for good — the
        // server's `false` to every browser read after it, `refresh` included.
        const followed = runInScope(
            undefined,
            () =>
                ambient<boolean>(
                    () => !isServer() && !isHydrating() && list.matches,
                ),
            undefined,
        )
        standIn(followed, false, () => list.matches)
        list.addEventListener('change', (event) => followed.set(event.matches))
        value = followed
    }
    queries.set(query, value)
    return value
}
