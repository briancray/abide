import { GET } from '@abide/abide/server'

import { digest } from './lib/digest.server.ts'

/** Answers at /ops/getDigest: when the digest last went out, and goes next. */
export default GET(digest.status, {
    description: 'When the follow-up digest last went out, and goes next.',
})
