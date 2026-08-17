// The stream `/streaming` renders, and the reason it is not `users.ts`'s `countdown`.
//
// A page that imports an rpc module gets that module's stubs in its OWN chunk. Two pages importing
// one module gets them hoisted into a SHARED chunk instead — in front of every page, including the
// ones that call nothing. `/users/[id]` already imports `users.ts`, so pointing the streamed panel
// there moved `getUser` and `countdown` out of both page chunks and into the common entry, and the
// elision test caught it by no longer finding the address where it belongs.
//
// One file per page's own endpoints is what keeps that from happening quietly. `countdown` stays
// where it is: the transport suite calls it, and nothing there renders a page.

import { GET } from 'abide/server'

/**
 * A handler that YIELDS, drained by the render and handed to the browser as a transcript.
 *
 * No delay between chunks: the claim the page makes about this one is the HANDOVER — every chunk in
 * the markup and no second request — and a sleep here would only make the response slower to say it.
 * The two panels above it are what the page uses to time anything.
 */
export const ticks = GET(async function* ({ from }: { from: number }) {
    for (let n = from; n > 0; n--) yield n
})
