import { GET, onStart } from '@abide/abide/server'
import { pool } from './server/pool.ts'

// Connect before the app answers anything; note when it came up.
onStart(async (start) => {
    await pool.connect()
    await start()
    pool.upAt = new Date().toISOString()
})

/** Answers at /ops/getPool: when the pool connected, and the app came up. */
export default GET(() => ({ connectedAt: pool.connectedAt, upAt: pool.upAt }), {
    description: 'When the pool connected, and when the app came up.',
})
