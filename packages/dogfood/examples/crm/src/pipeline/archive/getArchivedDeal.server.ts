import { rpc } from '@abide/abide/server'

import { ARCHIVED_DEAL } from '../lib/ARCHIVED_DEAL.server.ts'

/** Answers at /pipeline/archive/getArchivedDeal: a deal closed last year. */
export const getArchivedDeal = rpc(() => ARCHIVED_DEAL, {
    description: 'A deal from last year’s archived pipeline.',
})
