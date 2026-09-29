// The app data this example stands on.

export type Invoice = { number: string; total: string; dueOn: string }

const INVOICES: Record<string, Invoice> = {
    '42': { number: 'INV-0042', total: '$1,240.00', dueOn: '2026-09-14' },
}

/** A slow database, so the wait is on screen. */
export const database = {
    invoice: {
        async find(id: string): Promise<Invoice | undefined> {
            await Bun.sleep(450)
            return INVOICES[id]
        },
    },
}
