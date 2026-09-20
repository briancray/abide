// The app data this example stands on, so the download runs on its own.
// `vanilla/database.ts` is the hand-written arm's copy of the same fixture, and
// neither is counted in the line ratio: what the ratio prices is markup, client
// and handler, not the rows underneath them.

export type Invoice = { number: string; total: string; dueOn: string }

const INVOICES: Record<string, Invoice> = {
    '42': { number: 'INV-0042', total: '$1,240.00', dueOn: '2026-09-14' },
}

export const database = {
    invoice: {
        async find(id: string): Promise<Invoice | undefined> {
            return INVOICES[id]
        },
    },
}
