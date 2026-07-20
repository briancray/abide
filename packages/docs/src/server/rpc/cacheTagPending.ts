import { GET } from 'abide/server/GET'
import { invalidate } from 'abide/shared/invalidate'
import { pending } from 'abide/shared/pending'
import cacheTagA from './cacheTagA'
import cacheTagB from './cacheTagB'

// Surfaces the GLOBAL reactive aggregate `pending({ tags })` — true if ANY shared slot carrying a
// listed tag is on its first load. Server-only (the tag registry is server-side), so we expose it
// through a read. Deterministic: drop the tag's slots, kick a fresh load of each WITHOUT awaiting
// (so both are mid-first-load), then read the aggregate synchronously — it reports `true`.
export default GET(() => {
    invalidate({ tags: ['docs'] })
    void cacheTagA({ tag: 'a' })
    void cacheTagB({ tag: 'b' })
    return { pending: pending({ tags: ['docs'] }) }
})
