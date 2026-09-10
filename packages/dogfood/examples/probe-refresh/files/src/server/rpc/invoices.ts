import { GET } from 'abide/server'
import { database } from '#server/database'

export const getInvoice = GET(({ id }: { id: string }) => {
    return database.invoices.find(id)
})
