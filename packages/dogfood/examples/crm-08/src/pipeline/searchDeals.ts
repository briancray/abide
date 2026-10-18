import { GET } from '@abide/abide/server'
import { DEALS } from './lib/DEALS.server.ts'
import { LOADS } from './lib/LOADS.server.ts'

/** The deals whose name holds the query, ignoring case. */
export default GET(
    async ({ q }: { q: string }) => {
        // A slow search service, so the wait is on screen.
        await Bun.sleep(300)
        LOADS.search = (LOADS.search ?? 0) + 1
        const query = q.toLowerCase()
        const names: string[] = []
        for (const deal of DEALS)
            if (deal.name.toLowerCase().includes(query)) names.push(deal.name)
        return names
    },
    { description: 'Searches the deals by name.' },
)
