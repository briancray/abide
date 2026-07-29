import { GET } from 'abide/server/GET'
import { invalidate } from 'abide/shared/invalidate'
import { pending } from 'abide/shared/pending'
import cacheTagA from '$server/rpc/cacheTagA'
import cacheTagB from '$server/rpc/cacheTagB'

// Surfaces the GLOBAL reactive aggregate `pending({ tags })` — true if ANY shared slot carrying a
// listed tag is on its first load. Exposed through a read so the transition can be observed
// deterministically — NOT because the registry is server-side; tags are isomorphic and register in the
// browser too. Deterministic: drop the tag's slots, kick a fresh load of each WITHOUT awaiting
// (so both are mid-first-load), then read the aggregate synchronously — it reports `true`.
export default GET(() => {
    invalidate({ tags: ['docs'] })
    void cacheTagA({ tag: 'a' })
    void cacheTagB({ tag: 'b' })
    return { pending: pending({ tags: ['docs'] }) }
})
