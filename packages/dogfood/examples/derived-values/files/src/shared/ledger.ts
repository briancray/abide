// A `.ts` file has no sugar over a reactive value: a read is
// `rows()`, and there is no member short-circuit either, so a
// read that may still be in flight is guarded here where a
// `.abide` file would have lowered it to `rows()?.filter(…)`.
import { memo, state } from 'abide'
import { listInvoices } from '#server/rpc/invoices'

export const year = state(2026)
export const showPaid = state(false)

// The outer memo is what makes the call follow `year`. A setup
// body is untracked, so the call alone would register nothing.
export const rows = memo(() => listInvoices({ year: year() }))

// When `showPaid` is true the body never touches `row.paid`, and
// nothing about that has to be declared either.
export const visible = memo(() => {
    const all = rows() ?? []
    return showPaid() ? all : all.filter((row) => !row.paid)
})

export const total = memo(() =>
    visible().reduce((sum, row) => sum + row.total, 0),
)

// `transform` runs AFTER adoption, on the settled payload —
// reading the value to reshape it is what loses the adoption.
export const paidIds = memo(() => listInvoices({ year: year() }), {
    transform: (all) => new Set(all.filter((r) => r.paid).map((r) => r.id)),
})

// A write stands until the next recompute clobbers it, so this is
// a local draft re-seeded whenever its source lands new rows.
export const draft = memo(() => structuredClone(visible()))

// HOISTED above the await, so the read happens while the body is
// still tracked. `peek()` is the other repair, for a read that was
// meant to be untracked all along.
export const summary = memo(async () => {
    const shown = visible()
    const everything = await listInvoices({ year: 2025 }).settled()
    return `${shown.length} of ${everything.length}`
})
