import { GET } from '@abide/abide/server'
import { refuseNarrowedDatabase } from '#server/refuseNarrowedDatabase'
import { notYours, superseded } from '#shared/refuseNarrowedFailures'

export const getInvoice = GET(
    async ({ id }: { id: string }) => {
        const invoice = await refuseNarrowedDatabase.invoices.find(id)
        if (!invoice.mine) return notYours({ owner: invoice.owner })
        const { replacedBy } = invoice
        if (replacedBy) return superseded({ replacedBy })
        return invoice
    },
    { description: 'An invoice, by id, where it is yours and current.' },
)
