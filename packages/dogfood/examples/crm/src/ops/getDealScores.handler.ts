import { GET } from '@abide/abide/server'

import { dealScores } from './lib/dealScores.ts'

/** Answers at /ops/getDealScores: each deal's score as it lands. */
export default GET(() => dealScores, {
    description: 'Each deal scored, off the main thread.',
})
