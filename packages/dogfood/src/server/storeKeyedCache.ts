import { reactive } from 'abide/server'
import { redisStore } from '#server/redisStore'
import { type Settings, storeKeyedDatabase } from '#server/storeKeyedDatabase'

/** A store per args key, derived FROM the key rather than closed over. */
export const storeKeyedCache = reactive(
    ({ profile }: { profile: string }) =>
        storeKeyedDatabase.settings.forProfile(profile),
    { store: ({ profile }) => redisStore<Settings>(`settings:${profile}`) },
)
