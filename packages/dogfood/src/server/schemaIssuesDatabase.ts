// The app data this example stands on.
//
// MATCHED ON THE id, so the page's default query of `inv` finds rows and a
// shorter one is refused by the schema before this is ever called — which is
// the point: an issue keyed to a field is what the page reads, not an empty
// result.

export type Invoice = { id: string; total: string }

const INVOICES: Invoice[] = [
    { id: 'inv-4021', total: '$1,240.00' },
    { id: 'inv-4022', total: '$310.00' },
    { id: 'inv-4023', total: '$76.50' },
]

// A slow database, so the wait is on screen.
export const database = {
    invoices: {
        async search(query: string, limit: number): Promise<Invoice[]> {
            await Bun.sleep(450)
            const found: Invoice[] = []
            for (const invoice of INVOICES)
                if (invoice.id.includes(query.toLowerCase()))
                    found.push(invoice)
            return found.slice(0, limit)
        },
    },
}
