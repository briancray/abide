import { rpc } from '@abide/abide/server'

import { COMPANIES } from './lib/COMPANIES.server.ts'

/** The companies whose name or city holds the query, ignoring case. */
export default rpc(
    async ({ q }: { q: string }) => {
        // A slow search service, so the wait is on screen.
        await Bun.sleep(150)
        const query = q.toLowerCase()
        const found: { id: string; name: string; city: string }[] = []
        for (const { id, name, city } of COMPANIES)
            if (`${name} ${city}`.toLowerCase().includes(query))
                found.push({ id, name, city })
        return found
    },
    { description: 'Searches the companies by name and city.' },
)
