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

import { hydratedValue } from './hydrating.ts'
import type { Reactive } from './reactive/Reactive.ts'

const queries = new Map<string, Reactive<boolean>>()

/** Whether the document matches `query`, as a `Reactive<boolean>`. */
export function media(query: string): Reactive<boolean> {
    const held = queries.get(query)
    if (held !== undefined) return held
    const list = typeof window === 'undefined' ? undefined : matchMedia(query)
    // 41.32 — the server's answer while the page hydrates, and the browser's after.
    // 23.30 — first asked inside a request, its home is still built outside it (`scoped.ts`).
    const { value, write } = hydratedValue(false, () => list?.matches === true)
    list?.addEventListener('change', (event) => write(event.matches))
    queries.set(query, value)
    return value
}
