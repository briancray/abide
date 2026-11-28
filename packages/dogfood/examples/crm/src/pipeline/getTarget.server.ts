import { memo } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { targets } from './lib/targets.server.ts'

/** The team's target, or `null` where nobody has set one. */
export const getTarget = rpc(
    memo(
        async () => {
            const newest = targets().at(-1)
            // Slowed, so the wait is on screen.
            await Bun.sleep(300)
            return newest?.target ?? null
        },
        // 16.89 — read again when `setTarget` refreshes the tag.
        { global: true, tags: ['targets'] },
    ),
    { description: "Reads the team's target for the quarter." },
)
