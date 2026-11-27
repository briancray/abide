import { rpc } from '@abide/abide/server'

import { digest } from './lib/digest.server.ts'

/** Sends the digest now, or joins the send already going out. */
export const sendDigest = rpc(() => digest.run(), {
    methods: ['POST'],
    description: 'Sends the follow-up digest now.',
})
