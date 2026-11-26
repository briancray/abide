import { rpc } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** Sets the target the whole team sees. */
export default rpc(
    ({ target }: { target: number }) => {
        crmDatabase.sql`INSERT INTO targets (target) VALUES (${target})`
    },
    {
        methods: ['POST'],
        description: "Sets the team's target for the quarter.",
    },
)
