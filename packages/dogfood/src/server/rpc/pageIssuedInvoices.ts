import { GET, page } from 'abide/server'
import { pageIssuedDatabase } from '#server/pageIssuedDatabase'

export const issuedInvoice = GET(
    async ({ id }: { id: string }) =>
        page(await pageIssuedDatabase.invoices.issuedCopy(id)),
    { description: 'The issued copy of an invoice, as a page.' },
)
