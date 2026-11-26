import { log } from '@abide/abide'
import { job, store } from '@abide/abide/server'

import { crmDatabase } from '../../pipeline/lib/crmDatabase.server.ts'
import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** At eight on weekday mornings in New York: the leads still waiting on a follow-up, mailed to the team. */
export const digest = job({
    name: 'digest',
    cron: '0 8 * * 1-5',
    timeZone: 'America/New_York',
    run: async () => {
        const leads = DEALS.filter((deal) => deal.stage === 'lead')
        await Bun.sleep(300) // the mail going out
        crmDatabase.sql`INSERT INTO digests (sentAt) VALUES (${Date.now()})`
        log.info(`digest sent: ${leads.length} leads to follow up`)
    },
    // Its status kept beside the CRM's tables, so a restart sends a morning it missed once, never twice.
    store: store.sqlite(crmDatabase, 'digest'),
})
