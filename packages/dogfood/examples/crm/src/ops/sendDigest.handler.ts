import { POST } from '@abide/abide/server'

import { digest } from './lib/digest.server.ts'

/** Sends the digest now, or joins the send already going out. */
export default POST(() => digest.runNow(), {
    description: 'Sends the follow-up digest now.',
})
