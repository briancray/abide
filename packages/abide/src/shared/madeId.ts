// 41.36 — THE ID A PART MAKES WHERE THE APP GIVES NONE, counted rather than drawn at random, so the
// browser's re-run of setup (41.6) makes the id the server wrote. A random one was made again in the
// browser, and the parts carrying it were written again with it, while an attribute an app wrote off
// the part's `id` — `aria-describedby={tip.id}` — kept the server's, naming nothing.
//
// A server counts per render, keyed by the stops of the work rendering (a request's scope, or a
// `render` outside every request); a browser counts per document from its hydration on. A part made
// outside both — at a module's top level, on either side — takes an id of a series of its own, so it
// never shares one with a part a render counted.

import { serverStops } from './reactive/scoping.ts'

const COUNTS = new WeakMap<object, number>()
const COUNTER = { module: 0, document: undefined as number | undefined }

/** The next id `prefix` names, counted in the order parts are set up. */
export function madeId(prefix: string): string {
    const stops = serverStops()
    if (stops !== undefined) {
        const count = COUNTS.get(stops) ?? 0
        COUNTS.set(stops, count + 1)
        return `${prefix}-${count}`
    }
    if (COUNTER.document === undefined) return `${prefix}-m${COUNTER.module++}`
    return `${prefix}-${COUNTER.document++}`
}

/** 41.36 — a hydration's count starts where its render's did. */
export function startMadeIds(): void {
    COUNTER.document = 0
}
