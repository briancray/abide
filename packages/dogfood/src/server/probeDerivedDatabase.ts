// The app data this example stands on.

export type Invoice = { id: string; total: string; paid: boolean }

const INVOICES: Invoice[] = [
    { id: '4021', total: '$1,240.00', paid: false },
    { id: '4022', total: '$310.00', paid: true },
    { id: '4023', total: '$76.50', paid: false },
]

/** A slow database, so the wait is on screen. */
export const database = {
    invoices: {
        async all(): Promise<Invoice[]> {
            await Bun.sleep(900)
            return INVOICES
        },
    },
}
