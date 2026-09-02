import { GET, refuse } from 'abide/server'
import { database } from '#server/database'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    const invoice = await database.invoice.find(id)
    if (!invoice) return refuse(404)
    return invoice
})
