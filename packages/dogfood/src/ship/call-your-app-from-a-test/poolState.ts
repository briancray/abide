import { GET } from '@abide/abide/server'
import { pool } from './lib/pool.ts'

export default GET(() => ({ connected: pool.connected }), {
    description: 'Whether the pool is connected.',
})
