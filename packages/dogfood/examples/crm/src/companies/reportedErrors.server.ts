import { rpc } from '@abide/abide/server'

import { tracker } from './lib/tracker.server.ts'

/** Answers at /companies/reportedErrors: what the tracker was sent. */
export default rpc(async () => tracker.captured, {
    description: 'The errors the tracker was sent.',
})
