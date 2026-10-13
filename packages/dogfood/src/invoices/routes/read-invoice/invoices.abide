import { GET, notFound } from '@abide/abide/server'
import { readInvoiceDatabase } from '#server/readInvoiceDatabase'

export const getInvoice = GET(
    async ({ id }: { id: string }) => {
        const invoice = await readInvoiceDatabase.invoice.find(id)
        return invoice ?? notFound({ path: `/invoices/${id}`, method: 'GET' })
    },
    { description: 'An invoice, by id.' },
)
