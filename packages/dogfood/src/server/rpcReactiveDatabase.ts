// The app data this example stands on.

export type Invoice = { total: string }

const INVOICES: Record<string, Invoice> = { '4021': { total: '$1,240.00' } }

/** A slow database, so the wait is on screen. */
export const rpcReactiveDatabase = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            await Bun.sleep(700)
            const row = INVOICES[id]
            if (row === undefined) throw new Error(`no row ${id}`)
            return row
        },
    },
}
