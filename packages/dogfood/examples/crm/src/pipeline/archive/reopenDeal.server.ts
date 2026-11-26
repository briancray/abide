import { rpc } from '@abide/abide/server'

import { ARCHIVED_DEAL } from '../lib/ARCHIVED_DEAL.server.ts'

/** Moves the archived deal back to a proposal. */
export default rpc(
    () => {
        ARCHIVED_DEAL.stage = 'proposal'
        return ARCHIVED_DEAL
    },
    {
        methods: ['POST'],
        description: 'Reopens a deal from last year’s pipeline.',
    },
)
