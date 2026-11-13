import { GET } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** The team's target, or `null` where nobody has set one. */
export default GET(
    async () => {
        // Slowed, so the wait is on screen.
        await Bun.sleep(300)
        const newest = crmDatabase()
            .query('SELECT target FROM targets ORDER BY id DESC LIMIT 1')
            .get() as { target: number } | null
        return newest?.target ?? null
    },
    { description: "Reads the team's target for the quarter." },
)
