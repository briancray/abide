import { GET } from '@abide/abide/server'

type InvoiceRow = { number: string; dueOn: string; total: string }

const INVOICES: Record<string, InvoiceRow> = {
    '4021': { number: 'INV-4021', dueOn: '2026-09-14', total: '$1,240.00' },
}

/** Address from the file's path; schemas from the annotation. */
export default GET(
    async ({ id }: { id: string }) => {
        await Bun.sleep(700) // a slow database, so the wait is on screen
        const row = INVOICES[id]
        if (row === undefined) throw new Error(`no row ${id}`)
        return row
    },
    { description: 'An invoice, by id.' },
)
