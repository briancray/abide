import { PATCH_BUS } from './runtime/PATCH_BUS.ts'
import type { Doc } from './runtime/types/Doc.ts'
import type { SyncTransport } from './types/SyncTransport.ts'

/*
Shares a document's state across peers in real time. Two directions over one
`transport`, both riding the patch bus:
  - OUTBOUND: every local patch to `doc` is published (`transport.send`);
  - INBOUND: every peer patch is applied to `doc`.
An inbound apply emits on the bus like any change, so an `applying` guard stops it
being echoed straight back — the thing that would otherwise ping-pong forever. The
transport itself should not deliver a sender its own patch either; together the two
guards keep a write to a path from looping. Last-write-wins by arrival order;
edits to *different* paths never conflict, by construction of the doc's wake. A
late joiner needs a snapshot seed before live patches (a transport concern, out of
this core). Returns a disposer.
*/
// @documentation plumbing
export function sync(doc: Doc, transport: SyncTransport): () => void {
    /* True only while applying a received patch, so its bus echo isn't re-sent. */
    let applying = false

    const unsubscribeInbound = transport.subscribe((patch) => {
        applying = true
        try {
            doc.apply(patch)
        } finally {
            applying = false
        }
    })

    const unsubscribeBus = PATCH_BUS.subscribe((event) => {
        if (event.doc === doc && !applying) {
            transport.send(event.patch)
        }
    })

    return () => {
        unsubscribeBus()
        unsubscribeInbound()
    }
}
