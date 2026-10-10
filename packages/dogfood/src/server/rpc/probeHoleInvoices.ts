import { GET } from '@abide/abide/server'
import { probeHoleDatabase } from '#server/probeHoleDatabase'

export const getInvoice = GET(
    ({ id }: { id: string }) => {
        return probeHoleDatabase.invoices.find(id)
    },
    { description: 'An invoice, by id.' },
)
