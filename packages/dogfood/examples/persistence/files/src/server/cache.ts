import { memo } from 'abide/server'
import { database } from '#server/database'
import { redisStore } from '#server/redisStore'

const FLAGS_URL = 'https://flags.internal/v1'

// In front of a BODY the store is a cache that survives a restart:
// `get` on a cold entry, the body on a miss, `set` on every
// production. So a deploy that restarts every instance no longer
// stampedes the thing behind it.
export const flags = memo(async () => (await fetch(FLAGS_URL)).json(), {
    global: true,
    ttl: 60_000,
    store: redisStore('flags'),
})

// A keyed memo builds one `Reactive` per args key, so a store
// keyed on anything is derived FROM that key. Closing over one key
// instead gives every entry the same store, and they clobber each
// other silently.
export const user = memo(
    ({ id }: { id: string }) => database.user.find(id),
    {
        global: true,
        ttl: 30_000,
        store: ({ id }) => redisStore(`user:${id}`),
    },
)
