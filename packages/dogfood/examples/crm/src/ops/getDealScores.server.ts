import { rpc } from '@abide/abide/server'

import { dealScores } from './lib/dealScores.server.ts'

/** Answers at /ops/getDealScores: each deal's score as it lands. */
export const getDealScores = rpc(dealScores, {
    description: 'Each deal scored, off the main thread.',
})
