import { rpc } from '@abide/abide/server'

import { followUps } from './lib/followUps.server.ts'

/** Answers at /ops/getFollowUps: the leads the last check found. */
export default rpc(followUps, {
    description: 'The leads still waiting on a follow-up.',
})
