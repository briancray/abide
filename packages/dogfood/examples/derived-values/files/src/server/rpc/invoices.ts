import { GET } from 'abide/server'

const ROWS = [
    { id: 1, ref: 'INV-0041', year: 2026, total: 400, paid: true },
    { id: 2, ref: 'INV-0042', year: 2026, total: 1240, paid: false },
    { id: 3, ref: 'INV-0043', year: 2026, total: 96, paid: false },
]

// ONE PARAMETER, so this is a keyed memo: a factory with an entry
// per args key rather than a single value. The probes live on the
// invoked result — `listInvoices({ year }).pending()`.
export const listInvoices = GET((args: { year: number }) =>
    ROWS.filter((row) => row.year === args.year),
)
