import { memo } from '@abide/abide'
import { job } from '@abide/abide/server'

import { scoreDeals } from './scoreDeals.worker.ts'

/** Every deal's score, as the last scoring left it. */
export const dealScores = memo(scoreDeals, { global: true, tags: ['scores'] })

/** Rescored an hour after the last scoring ends, from a minute in, whether or not anyone reads the scores. */
export const rescoreDeals = job({
    name: 'rescoreDeals',
    every: 3_600_000,
    delay: 60_000,
    run: async () => {
        dealScores.refresh()
        for await (const _ of dealScores());
    },
})
