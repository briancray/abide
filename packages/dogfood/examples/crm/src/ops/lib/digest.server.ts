import { job, log } from '@abide/abide/server'

import { crmDatabase } from '../../pipeline/lib/crmDatabase.server.ts'
import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** Every night: the leads still waiting on a follow-up, mailed to the team. */
export const digest = job({
    name: 'digest',
    every: 24 * 60 * 60_000,
    run: async () => {
        const leads = DEALS.filter((deal) => deal.stage === 'lead')
        await Bun.sleep(300) // the mail going out
        crmDatabase().run('INSERT INTO digests (sentAt) VALUES (?)', [
            Date.now(),
        ])
        log.info(`digest sent: ${leads.length} leads to follow up`)
    },
    // When the last one went out, so a restart waits out the rest of the night.
    lastRun: () =>
        crmDatabase()
            .query<{ sentAt: number | null }, []>(
                'SELECT max(sentAt) AS sentAt FROM digests',
            )
            .get()?.sentAt ?? undefined,
})
