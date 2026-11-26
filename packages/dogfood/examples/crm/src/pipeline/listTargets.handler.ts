import { GET } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.server.ts'
import type { Target } from './lib/targets.server.ts'

/** The last five targets set, newest first. */
export default GET(
    () =>
        crmDatabase.sql<Target>`SELECT id, target, setAt FROM targets
            ORDER BY id DESC LIMIT 5`,
    { description: 'Lists the targets the team has set, newest first.' },
)
