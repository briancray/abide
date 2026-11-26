import { memo } from '@abide/abide'

import { scoreDeals } from './scoreDeals.worker.ts'

/** Rescored an hour after the last scoring ends, from a minute in. */
export const dealScores = memo(scoreDeals, {
    global: true,
    tags: ['scores'],
    poll: { every: 3_600_000, after: 'settle', delay: 60_000 },
})
