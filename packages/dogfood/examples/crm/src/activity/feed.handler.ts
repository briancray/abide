import { GET } from '@abide/abide/server'

import { feeds } from './lib/feeds.ts'

/** Answers at /activity/feed; every tab reading it follows it. */
export default GET(feeds, { description: "An account's activity feed." })
