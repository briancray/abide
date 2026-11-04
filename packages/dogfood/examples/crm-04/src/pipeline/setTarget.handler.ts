import { POST } from '@abide/abide/server'

import { TEAM } from './lib/TEAM.server.ts'

/** Sets the target the whole team sees. */
export default POST(
    ({ target }: { target: number }) => {
        TEAM.target = target
    },
    { description: "Sets the team's target for the quarter." },
)
