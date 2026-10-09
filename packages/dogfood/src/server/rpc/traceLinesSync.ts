import { log, POST, trace } from 'abide/server'
import { traceLinesBilling } from '#server/traceLinesBilling'

export const syncContact = POST(
    async ({ id }: { id: string }) => {
        log(`contact ${id} loaded`)
        await traceLinesBilling.notify(id)
        const lines: string[] = []
        for (const record of log.records.history(50))
            if (record.trace === trace()) lines.push(record.message)
        return { trace: trace(), lines }
    },
    {
        description:
            'Syncs a contact, and answers the log lines its trace wrote.',
    },
)
