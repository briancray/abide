import { GET } from '@abide/abide/server'
import { rpcReactiveDatabase } from '#server/rpcReactiveDatabase'

/** Address from the file path and export; schemas from the annotation. */
export const getInvoice = GET(
    ({ id }: { id: string }) => {
        return rpcReactiveDatabase.invoices.find(id)
    },
    { description: 'An invoice, by id.' },
)
