import { POST } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** Sets the target the whole team sees. */
export default POST(
    ({ target }: { target: number }) => {
        crmDatabase.sql`INSERT INTO targets (target) VALUES (${target})`
    },
    { description: "Sets the team's target for the quarter." },
)
