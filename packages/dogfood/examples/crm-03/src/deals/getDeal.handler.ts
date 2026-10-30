import { refuse } from '@abide/abide'
import { GET } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

/** Answers at /deals/getDeal?id=…; the argument type is the schema. */
export default GET(
    async ({ id }: { id: string }) => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(300)
        return DEALS.find((deal) => deal.id === id) ?? refuse(404)
    },
    { description: 'One deal, by id.' },
)
