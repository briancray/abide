import { job, log } from '@abide/abide/server'

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
        crmDatabase().run('INSERT INTO digests (sentAt) VALUES (?)', [
            Date.now(),
        ])
        log.info(`digest sent: ${leads.length} leads to follow up`)
    },
    // When the last one went out, so a restart sends a morning it missed once, and never twice.
    lastRun: () =>
        crmDatabase()
            .query<{ sentAt: number | null }, []>(
                'SELECT max(sentAt) AS sentAt FROM digests',
            )
            .get()?.sentAt ?? undefined,
})
