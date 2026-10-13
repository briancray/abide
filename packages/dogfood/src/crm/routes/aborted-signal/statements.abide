import { GET } from '@abide/abide/server'

export const getStatement = GET(
    async ({ id }: { id: string }) => {
        // A slow ledger, so there is time to cancel.
        await Bun.sleep(2500)
        return { id, total: '$1,240.00' }
    },
    { description: 'The total of a statement, by id, from a slow ledger.' },
)
