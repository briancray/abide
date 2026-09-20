// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// THREE ROWS AGAINST A SCHEMA THAT CAPS THE LIMIT AT 3, so the page can ask for
// a limit the schema refuses and get the refusal rather than a short list —
// which is the rung order the example is about: the middleware runs, then the
// args are validated, then the body.

export type Invoice = { id: string; total: string }

const INVOICES: Invoice[] = [
    { id: '4021', total: '$1,240.00' },
    { id: '4022', total: '$310.00' },
    { id: '4023', total: '$76.50' },
]

export const database = {
    invoices: {
        async recent(limit: number): Promise<Invoice[]> {
            return INVOICES.slice(0, limit)
        },
    },
}
