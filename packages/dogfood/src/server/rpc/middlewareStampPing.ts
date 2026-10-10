import { GET } from '@abide/abide/server'

/** Writes no header of its own. */
export const ping = GET(() => 'pong', { description: 'Answers pong.' })
