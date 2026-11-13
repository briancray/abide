import { GET } from '@abide/abide/server'

import { followUps } from './lib/followUps.ts'

/** Answers at /ops/getFollowUps: the leads the last check found. */
export default GET(() => followUps, {
    description: 'The leads still waiting on a follow-up.',
})
