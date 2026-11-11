import { GET } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'

/** The last five targets set, newest first. */
export default GET(
    () =>
        crmDatabase()
            .query(
                `SELECT id, target, setAt FROM targets
                ORDER BY id DESC LIMIT 5`,
            )
            .all() as { id: number; target: number; setAt: string }[],
    { description: 'Lists the targets the team has set, newest first.' },
)
