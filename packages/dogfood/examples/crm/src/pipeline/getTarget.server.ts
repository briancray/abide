import { rpc } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** The team's target, or `null` where nobody has set one. */
export default rpc(
    async () => {
        // Slowed, so the wait is on screen.
        await Bun.sleep(300)
        const [newest] = crmDatabase.sql<{
            target: number
        }>`SELECT target FROM targets ORDER BY id DESC LIMIT 1`
        return newest?.target ?? null
    },
    { description: "Reads the team's target for the quarter." },
)
