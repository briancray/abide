// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// KEYED ON THE LOWERCASED id, which is what the schema coerces to — so
// `ABC-123` and `abc-123` reach the same row and the two entries the example
// counts are a fact about the CACHE rather than about what is stored here.

export type Invoice = { ref: string }

const INVOICES: Record<string, Invoice> = { 'abc-123': { ref: 'ABC-123' } }

export const database = {
    invoices: {
        async find(id: string): Promise<Invoice> {
            return INVOICES[id]
        },
    },
}
