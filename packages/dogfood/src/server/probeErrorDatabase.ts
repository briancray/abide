// The app data this example stands on.
//
// `4021` IS NOT HERE ON PURPOSE. The page asks for it and the handler answers
// `notReachable`, which is the whole of what this example shows — a row that is
// absent rather than a lookup that threw. A fixture holding it would make the
// error path unreachable.

export type Invoice = { total: string }

const INVOICES: Record<string, Invoice> = { '4020': { total: '$980.00' } }

// A slow database, so the wait is on screen.
export const database = {
    invoices: {
        async find(id: string): Promise<Invoice | null> {
            await Bun.sleep(600)
            return INVOICES[id] ?? null
        },
    },
}
