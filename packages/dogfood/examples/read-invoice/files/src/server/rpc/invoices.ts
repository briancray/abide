import { GET, notFound } from 'abide/server'
import { database } from '#server/database'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    const invoice = await database.invoice.find(id)
    return invoice ?? notFound({ path: `/invoices/${id}`, method: 'GET' })
})
