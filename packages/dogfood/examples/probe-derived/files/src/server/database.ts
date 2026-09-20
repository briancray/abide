// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.

export type Invoice = { id: string; total: string; paid: boolean }

const INVOICES: Invoice[] = [
    { id: '4021', total: '$1,240.00', paid: false },
    { id: '4022', total: '$310.00', paid: true },
    { id: '4023', total: '$76.50', paid: false },
]

export const database = {
    invoices: {
        async all(): Promise<Invoice[]> {
            return INVOICES
        },
    },
}
