// The `/data` page's supply — one endpoint, because of where this file sits.
//
// The delay is REAL, and that is the whole reason it is here rather than a promise the page resolves
// for itself: a body that settles on a microtask is read warm by whatever renders next, so a pending
// arm never shows, a probe never reports true and every claim about waiting is green for free.
//
// `/data` is a browser page, so this module reaches the client lane as its ADDRESS and none of this
// text — `buildCatalogue` and the ~10,000 objects it makes stay on this side of `server/rpc/`.

import { GET } from 'abide/server'
import { buildCatalogue, type CatalogueEntry } from '../../catalogue.ts'

/** Long enough to see, short enough that a harness driving the page is not mostly waiting. */
const DELAY_MS = 120

// Raised for the n-sweep in `~/code/abide-interact-probe.ts`: the question it asks is at what row
// count an interaction crosses a frame, and 2000 was under the answer on every arm.
const MOST = 20000

export const catalogue = GET(async ({ shard, size }: { shard: number; size: number }): Promise<CatalogueEntry[]> => {
    await Bun.sleep(DELAY_MS)
    return buildCatalogue(shard, Math.min(Math.max(size, 0), MOST))
})
