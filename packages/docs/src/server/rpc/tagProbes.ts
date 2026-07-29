import { GET } from 'abide/server/GET'
import { pending } from 'abide/shared/pending'
import { refreshing } from 'abide/shared/refreshing'
import cacheTagSlow from './cacheTagSlow'

// The GLOBAL tag PROBES — reactive aggregates: true if ANY slot carrying the tag is pending /
// refreshing. Exposed through a READ here because this handler captures both transitions in one
// deterministic pass — not because the probes are server-only. They are not: tags stopped requiring
// `crossRequest` and are isomorphic, so a tagged read's BROWSER memo registers too and these
// aggregates answer on both sides. A slot goes pending SYNCHRONOUSLY when its load starts, and
// refreshing when it revalidates over a retained value.
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
