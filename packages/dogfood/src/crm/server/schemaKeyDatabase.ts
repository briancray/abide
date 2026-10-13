// The app data this example stands on.
//
// KEYED ON THE LOWERCASED id, which is what the schema coerces to — so
// `ABC-123` and `abc-123` reach the same row and the two entries the example
// counts are a fact about the CACHE rather than about what is stored here.

export type Invoice = { ref: string }

const INVOICES: Record<string, Invoice> = { 'abc-123': { ref: 'ABC-123' } }

/** A slow database, so the wait is on screen. */
export const schemaKeyDatabase = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            await Bun.sleep(900)
            const row = INVOICES[id]
            if (row === undefined) throw new Error(`no row ${id}`)
            return row
        },
    },
}
