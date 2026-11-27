import { memo } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { targets } from './lib/targets.server.ts'

/** The team's target, or `null` where nobody has set one. */
export const getTarget = rpc(
    memo(
        async () => {
            // 47.29 — called, the table reads this again after any committed change, whoever wrote it.
            const newest = targets().at(-1)
            // Slowed, so the wait is on screen.
            await Bun.sleep(300)
            return newest?.target ?? null
        },
        { global: true },
    ),
    { description: "Reads the team's target for the quarter." },
)
