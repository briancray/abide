import { log, POST, trace } from '@abide/abide/server'

import { billing } from './lib/billing.ts'

/** Answers at /ops/syncContact: syncs a contact, with its trace's lines. */
export default POST(
    async ({ id }: { id: string }) => {
        log(`contact ${id} loaded`)
        await billing.notify(id)
        const lines: string[] = []
        for (const record of log.records().slice(-50))
            if (record.trace === trace()) lines.push(record.message)
        return { trace: trace(), lines }
    },
    { description: 'Syncs a contact to billing.' },
)
