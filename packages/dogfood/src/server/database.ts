// The fixture the documentation examples read through. Not a database and not a
// database wrapper — examples need one row each, and a real driver here would put a
// service in the way of a page whose whole claim is that nothing is in the way.
//
// `find` answers with the row or `undefined`. That is the contract the examples are
// written against: `loading`'s handler guards on it and publishes the `refuse(404)`
// that follows, and `read-invoice` hands the promise straight back, which is what
// makes its `Reactive` loaded.

export type Invoice = { number: string; total: string; dueOn: string }

const INVOICES: Record<string, Invoice> = {
    '42': { number: 'INV-0042', total: '$1,240.00', dueOn: '2026-09-14' },
}

export const database = {
    invoice: {
        // Async because a read that resolves is what the loading and pending states in
        // these examples are about; a synchronous fixture would have no hole to fill.
        async find(id: string): Promise<Invoice | undefined> {
            return INVOICES[id]
        },
    },
}
