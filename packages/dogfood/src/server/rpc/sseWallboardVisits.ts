import { GET, sse } from 'abide/server'
import { sseWallboardDatabase } from '#server/sseWallboardDatabase'

export const visits = GET(() => sse(sseWallboardDatabase.visits.latest()), {
    description: 'Live visits, as server-sent events.',
})
