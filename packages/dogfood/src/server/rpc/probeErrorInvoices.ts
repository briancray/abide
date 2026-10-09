import { GET } from 'abide/server'
import { probeErrorDatabase } from '#server/probeErrorDatabase'
import { notReachable } from '#shared/notReachable'

export const getInvoice = GET(
    async ({ id }: { id: string }) => {
        const found = await probeErrorDatabase.invoices.find(id)
        if (found === null) return notReachable({ id })
        return found
    },
    { description: 'An invoice, by id.' },
)
