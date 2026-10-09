import { GET } from 'abide/server'
import { probeDerivedDatabase } from '#server/probeDerivedDatabase'

export const listInvoices = GET(() => probeDerivedDatabase.invoices.all(), {
    description: 'Every invoice.',
})
