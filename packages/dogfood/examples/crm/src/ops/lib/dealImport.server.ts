import { memo } from '@abide/abide'
import { job, log } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** How many deals the last import pulled in, or `undefined` before one has. */
export const importedDeals = memo((): number | undefined => undefined, {
    global: true,
})

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
        importedDeals.set(deals.length)
        log.info(`imported: ${deals.length} deals checked against the old CRM`)
    },
})
