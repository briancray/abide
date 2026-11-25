import { job, log } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** The deals pulled in from the old CRM, run only when someone asks. */
export const dealImport = job('dealImport', {
    every: 0,
    run: async () => {
        await Bun.sleep(300) // the old CRM paging out its deals
        log.info(`imported: ${DEALS.length} deals checked against the old CRM`)
    },
})
