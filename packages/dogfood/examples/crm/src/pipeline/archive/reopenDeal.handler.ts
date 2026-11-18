import { POST } from '@abide/abide/server'

import { ARCHIVED_DEAL } from '../lib/ARCHIVED_DEAL.server.ts'

/** Moves the archived deal back to a proposal. */
export default POST(
    () => {
        ARCHIVED_DEAL.stage = 'proposal'
        return ARCHIVED_DEAL
    },
    { description: 'Reopens a deal from last year’s pipeline.' },
)
