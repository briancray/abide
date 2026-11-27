import { rpc } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** Sets the target the whole team sees. */
export const setTarget = rpc(
    ({ target }: { target: number }) => {
        crmDatabase.sql`INSERT INTO targets (target) VALUES (${target})`
    },
    {
        methods: ['POST'],
        // 16.89 — what reads the table, refreshed once the target is written.
        refreshes: ['targets'],
        description: "Sets the team's target for the quarter.",
    },
)
