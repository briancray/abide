import { GET } from 'abide/server'

const PAID = new Set(['INV-4021'])

export const invoiceStatus = GET(
    ({ id }: { id: string }) => ({ id, paid: PAID.has(id) }),
    { description: 'Whether an invoice has been paid, by its number.' },
)
