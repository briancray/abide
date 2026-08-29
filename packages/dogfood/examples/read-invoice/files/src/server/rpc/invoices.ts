import { GET } from 'abide/server'
import { database } from '#server/database'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    return await database.invoice.find(id)
})
