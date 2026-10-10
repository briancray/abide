import { GET } from '@abide/abide/server'
import { startHookDatabase } from '#server/startHookDatabase'

/** When the pool connected, and when the app came up around it. */
export const poolState = GET(
    () => ({
        connectedAt: startHookDatabase.connectedAt,
        upAt: startHookDatabase.upAt,
    }),
    { description: 'When the pool connected, and when the app came up.' },
)
