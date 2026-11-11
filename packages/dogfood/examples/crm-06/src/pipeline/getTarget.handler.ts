import { GET } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.ts'

/** The team's target, or `null` where nobody has set one. */
export default GET(
    async () => {
        // Slowed, so the wait is on screen.
        await Bun.sleep(300)
        const row = crmDatabase().query('SELECT target FROM team').get() as {
            target: number
        } | null
        return row?.target ?? null
    },
    { description: "Reads the team's target for the quarter." },
)
