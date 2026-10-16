// The hand-written arm's own copy of the fixture, so the download runs on its own.
// Not counted in the line ratio: the abide arm's `#server/database` is not counted
// either, both being app data rather than markup, client or handler.

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
