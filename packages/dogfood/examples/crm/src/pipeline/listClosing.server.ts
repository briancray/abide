import { rpc } from '@abide/abide/server'

import { CLOSE_DATES } from './lib/CLOSE_DATES.server.ts'
import { DEALS } from './lib/DEALS.server.ts'

/** Every open deal with the date it is expected to close, where it has one. */
export default rpc(
    async () => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(300)
        const deals: {
            id: string
            name: string
            stage: string
            amount: number
            closes?: string
        }[] = []
        for (const deal of DEALS) {
            const closes = CLOSE_DATES[deal.id]
            deals.push(closes === undefined ? { ...deal } : { ...deal, closes })
        }
        return deals
    },
    { description: 'Every deal with its expected close date.' },
)
