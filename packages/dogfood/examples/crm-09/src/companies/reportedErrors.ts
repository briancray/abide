import { GET } from '@abide/abide/server'
import { tracker } from './server/tracker.ts'

/** Answers at /companies/reportedErrors: what the tracker was sent. */
export default GET(async () => tracker.captured, {
    description: 'The errors the tracker was sent.',
})
