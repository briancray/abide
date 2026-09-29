import { GET } from 'abide/server'
import { database } from '#server/rpcReactiveDatabase'

/** Address from the file path and export; schemas from the annotation. */
export const getInvoice = GET(({ id }: { id: string }) => {
    return database.invoices.find(id)
})
