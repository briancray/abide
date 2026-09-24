import { GET } from 'abide/server'
import { database } from '#server/probeDerivedDatabase'

export const listInvoices = GET(() => database.invoices.all())
