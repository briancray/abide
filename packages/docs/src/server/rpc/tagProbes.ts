import { GET } from 'abide/server/GET'
import { pending } from 'abide/shared/pending'
import { refreshing } from 'abide/shared/refreshing'
import cacheTagSlow from './cacheTagSlow'

// The GLOBAL tag PROBES — server-side reactive aggregates: true if ANY shared slot carrying the tag is
// pending / refreshing. The tag registry is server-only, so they read meaningfully here (not in the
// browser). This handler captures both transitions in one deterministic pass — a slot goes pending
// SYNCHRONOUSLY when its load starts, and refreshing when it revalidates over a retained value.
export default GET(
    async () => {
        cacheTagSlow.invalidate() // drop any retained slot
        const load = cacheTagSlow() // kick a fresh load (no await) → the slot goes pending now
        const pendingDuringLoad = pending({ tags: ['live'] })
        await load // let the first load settle → value retained
        const pendingAfterLoad = pending({ tags: ['live'] })

        cacheTagSlow.refresh() // revalidate over the retained value → refreshing now
        const refreshingDuringRefresh = refreshing({ tags: ['live'] })
        await cacheTagSlow() // coalesce onto the in-flight refresh, await settle
        const refreshingAfterRefresh = refreshing({ tags: ['live'] })

        return {
            pendingDuringLoad,
            pendingAfterLoad,
            refreshingDuringRefresh,
            refreshingAfterRefresh,
        }
    },
    { memo: false },
)
