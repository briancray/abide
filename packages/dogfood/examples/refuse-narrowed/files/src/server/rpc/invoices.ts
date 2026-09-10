import { GET } from 'abide/server'
import { database } from '#server/database'
import { notYours, superseded } from '#shared/failures'

export const getInvoice = GET(async ({ id }: { id: string }) => {
    const invoice = await database.invoices.find(id)
    if (!invoice.mine) return notYours({ owner: invoice.owner })
    const { replacedBy } = invoice
    if (replacedBy) return superseded({ replacedBy })
    return invoice
})
