import { GET } from '@abide/abide/server'
import { rpcCallDatabase } from '#server/rpcCallDatabase'

/** Address from the file path and export; schemas from the annotation. */
export const getInvoice = GET(
    ({ id }: { id: string }) => {
        return rpcCallDatabase.invoices.find(id)
    },
    { description: 'An invoice, by id.' },
)
