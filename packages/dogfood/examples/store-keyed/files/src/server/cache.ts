import { reactive } from 'abide/server'
import { database } from '#server/database'
import { redisStore } from '#server/redisStore'

type Profile = { profile: string }

// A store per args key, derived FROM the key rather than closed over.
export const settings = reactive(
    ({ profile }: Profile) => database.settings.forProfile(profile),
    { store: ({ profile }) => redisStore(`settings:${profile}`) },
)
