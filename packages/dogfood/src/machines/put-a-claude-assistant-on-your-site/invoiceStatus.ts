import { GET } from '@abide/abide/server'

const PAID = new Set(['INV-4021'])

export default GET(({ id }: { id: string }) => ({ id, paid: PAID.has(id) }), {
    description: 'Whether an invoice has been paid, by its number.',
})
