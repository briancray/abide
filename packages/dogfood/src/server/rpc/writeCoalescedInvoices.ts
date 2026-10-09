import { POST } from 'abide/server'
import { writeCoalescedDatabase } from '#server/writeCoalescedDatabase'

export const payInvoice = POST(
    ({ id }: { id: string }) => writeCoalescedDatabase.invoices.pay(id),
    { description: 'Marks an invoice paid.' },
)
