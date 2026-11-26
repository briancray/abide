import { log } from '@abide/abide'
import { job } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** The deals pulled in from the old CRM, every one or those at one stage, run only when someone asks. */
export const dealImport = job({
    name: 'dealImport',
    every: 0,
    run: async (options?: { stage?: string }) => {
        const stage = options?.stage
        const deals =
            stage === undefined
                ? DEALS
                : DEALS.filter((deal) => deal.stage === stage)
        await Bun.sleep(300) // the old CRM paging out its deals
        log.info(`imported: ${deals.length} deals checked against the old CRM`)
        // 54.41 — what a run answers is its status's `lastResult`.
        return deals.length
    },
})
