import { GET } from 'abide/server'
import { probeRefreshDatabase } from '#server/probeRefreshDatabase'

export const getInvoice = GET(
    ({ id }: { id: string }) => {
        return probeRefreshDatabase.invoices.find(id)
    },
    { description: 'An invoice, by id.' },
)
