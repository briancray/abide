import { memo } from 'abide/server'
import { database } from '#server/database'
import { redisStore } from '#server/redisStore'

type Profile = { profile: string }

// THE FUNCTION FORM. A keyed memo builds one `Reactive` per args
// key, so a store keyed on anything has to be derived FROM that
// key rather than closed over where the memo was declared.
export const settings = memo(
    ({ profile }: Profile) => database.settings.forProfile(profile),
    { store: ({ profile }) => redisStore(`settings:${profile}`) },
)
