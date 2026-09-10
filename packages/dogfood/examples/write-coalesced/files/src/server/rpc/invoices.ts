import { POST } from 'abide/server'
import { database } from '#server/database'

export const payInvoice = POST(({ id }: { id: string }) =>
    database.invoices.pay(id),
)
