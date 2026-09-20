// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.

export type Invoice = { number: string; customer: string; total: string }

const INVOICES: Record<string, Invoice> = {
    '4021': {
        number: 'INV-4021',
        customer: 'Ada Lovelace',
        total: '$1,240.00',
    },
}

export const database = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            return INVOICES[id]
        },
    },
}
