import { POST } from '@abide/abide/server'

import { crmDatabase } from './lib/crmDatabase.ts'

/** Sets the target the whole team sees. */
export default POST(
    ({ target }: { target: number }) => {
        crmDatabase()
            .query(
                `INSERT INTO team (id, target) VALUES (1, ?)
                ON CONFLICT (id) DO UPDATE SET target = excluded.target`,
            )
            .run(target)
    },
    { description: "Sets the team's target for the quarter." },
)
