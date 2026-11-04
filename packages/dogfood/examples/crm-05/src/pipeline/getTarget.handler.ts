import { GET } from '@abide/abide/server'

import { TEAM } from './lib/TEAM.server.ts'

/** The team's target, or `null` where nobody has set one. */
export default GET(
    async () => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(300)
        return TEAM.target ?? null
    },
    { description: "Reads the team's target for the quarter." },
)
