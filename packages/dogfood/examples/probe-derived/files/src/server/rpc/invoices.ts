import { GET } from 'abide/server'
import { database } from '#server/database'

export const listInvoices = GET(() => database.invoices.all())
