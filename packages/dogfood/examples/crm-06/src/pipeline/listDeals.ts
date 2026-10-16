import { GET } from '@abide/abide/server'
import { DEALS } from './server/DEALS.ts'

/** Every open deal, as a list. */
export default GET(
    async () => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(400)
        return DEALS.map((deal) => ({ ...deal }))
    },
    { description: 'Every deal in the pipeline.' },
)
