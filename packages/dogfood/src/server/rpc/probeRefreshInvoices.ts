import { GET } from 'abide/server'
import { database } from '#server/probeRefreshDatabase'

export const getInvoice = GET(({ id }: { id: string }) => {
    return database.invoices.find(id)
})
