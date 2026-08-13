// The furniture a table of cases and a table of measurements share — and deliberately not their COLUMNS.
//
// `/tests` reports a status per case and `/bench` reports four numbers per arm, so one column template
// over both would be a grid neither of them wanted. What they do share is everything around the columns:
// the sticky header, the suite heading that groups the rows, the filter chips, and the shape of a number.
// Those were written twice before this file existed, which is how the two tables came to disagree about
// what a heading looks like.

import type { SuiteName } from '../demos/SUITES.ts'
import { ORDER } from '../demos/SUITES.ts'

export const HEAD = 'text-xs uppercase tracking-widest text-slate-600'
export const NUMBER = 'font-mono text-xs tabular-nums text-right'
export const GROUP = 'px-3 py-2 text-xs uppercase tracking-widest text-slate-400 bg-slate-900/40'
export const STICKY = 'sticky top-12 z-[5] py-2 bg-slate-950/95 backdrop-blur'
export const TABLE = 'border-y border-slate-800 divide-y divide-slate-900'

export const CHIP = 'rounded border px-2 py-0.5 text-xs border-slate-800 text-slate-500 hover:text-slate-300'
export const CHIP_ON = 'rounded border px-2 py-0.5 text-xs border-sky-800 bg-sky-950 text-sky-300'

/**
 * Rows grouped into the suites they came from, in NAV order.
 *
 * One pass over the rows rather than a pass per suite: the rows already arrive in suite order, so a
 * group closes when the name changes and a suite nobody has a row from is never a heading. That last
 * part is the reason this is not `ORDER.map(...)` — a filter that leaves a suite with no rows should
 * leave the page with no heading for it.
 */
export function grouped<T extends { suite: string }>(rows: T[]): { suite: string; rows: T[] }[] {
    const groups: { suite: string; rows: T[] }[] = []
    for (const row of rows) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.suite === row.suite) last.rows.push(row)
        else groups.push({ suite: row.suite, rows: [row] })
    }
    return groups
}

/** Is this URL segment a suite? Both tables answer a `[suite]` route and both may be handed nonsense. */
export function isSuite(name: string): name is SuiteName {
    return (ORDER as string[]).includes(name)
}
