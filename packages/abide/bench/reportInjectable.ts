// THE BATCHER, BUILT INTO ONE FILE A PAGE CAN BE INJECTED WITH, for the browser specs whose arms
// arrive as a compiled page's script rather than as a bundled case list. `listInjectable.ts`
// bundles its cases WITH the batcher; these specs build their pages in a bun child and hand the
// arms over as source, so the page needs the batcher on its own. `harness/report` is the leaf with
// no abide in its graph, so this bundles nothing a compiled page could collide with.

import { batch, claimOf, emulatedDom, ratio } from '@abide/harness/report'

;(
    globalThis as unknown as {
        __REPORT__: {
            batch: typeof batch
            claimOf: typeof claimOf
            emulatedDom: typeof emulatedDom
            ratio: typeof ratio
        }
    }
).__REPORT__ = { batch, claimOf, emulatedDom, ratio }
