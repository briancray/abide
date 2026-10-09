import { GET } from 'abide/server'
import { storeKeyedCache } from '#server/storeKeyedCache'

export const getSettings = GET(storeKeyedCache, {
    description: 'The settings of a profile.',
})
