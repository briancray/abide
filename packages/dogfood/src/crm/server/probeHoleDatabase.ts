// The app data this example stands on.

export type Invoice = { number: string; customer: string; total: string }

const INVOICES: Record<string, Invoice> = {
    '4021': {
        number: 'INV-4021',
        customer: 'Ada Lovelace',
        total: '$1,240.00',
    },
}

/** A slow database, so the wait is on screen. */
export const probeHoleDatabase = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            await Bun.sleep(900)
            const row = INVOICES[id]
            if (row === undefined) throw new Error(`no row ${id}`)
            return row
        },
    },
}
