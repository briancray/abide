// The furniture a table of cases and a table of measurements share — and deliberately not their COLUMNS.
//
// `/tests` reports a status per case and `/bench` reports four numbers per arm, so one column template
// over both would be a grid neither of them wanted. What they do share is everything around the columns:
// the sticky header, the suite heading that groups the rows, the filter chips, and the shape of a number.
// Those were written twice before this file existed, which is how the two tables came to disagree about
// what a heading looks like.

import type { BenchRow, Case } from 'abide-kit'
import type { SuiteName } from '../demos/SUITES.ts'
import { ORDER } from '../demos/SUITES.ts'

/**
 * The bench table's columns: what was measured, abide, by hand, the difference, and the run button.
 *
 * Here because the STICKY HEADER is `bench-table.abide`'s and the ROWS under it are `arms.abide`'s,
 * so the template belongs to neither of them. A header whose columns have drifted from its rows is
 * worse than no header — it labels the wrong numbers and nothing about the page looks broken.
 */
export const BENCH_ROW = 'grid grid-cols-[minmax(0,1fr)_7rem_7rem_5rem_8rem_3rem] items-center gap-x-4 px-3'

/**
 * The ARM table inside a row, which is deliberately NOT `BENCH_ROW`.
 *
 * The summary is a comparison and wants four wide cells; an arm is a distribution and wants seven
 * narrow ones. Laying the second on the first put a duration under a heading that said `by hand` and
 * squeezed the ratio into the run button's column, which is how the mismatch shows up — the two
 * tables answer different questions and only one of them fits per line.
 */
export const BENCH_ARM = 'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_5.5rem_5rem_6.5rem] items-center gap-x-3 px-3'

/**
 * The case table's columns: the disclosure chevron, what is claimed, and the status.
 *
 * Here for `BENCH_ROW`'s reason — the header is `cases.abide`'s and the rows are `case-row.abide`'s —
 * and it earned it the same way: the chevron column was added to the row and not to the header, so
 * every title on the page sat one notch right of the word above it.
 */
export const CASE_ROW = 'grid grid-cols-[0.75rem_minmax(0,1fr)_7rem] items-baseline gap-x-3 px-3'

/**
 * The typography every column heading and status badge shares, with NO colour in it.
 *
 * Split out of `HEAD` because `class="{HEAD} text-emerald-500"` is two `color` utilities of equal
 * specificity, and which one wins is decided by the order TAILWIND EMITTED them rather than by the
 * order they appear in the attribute — slate did, so every `passing` on `/tests` rendered grey and
 * nothing about the markup looked wrong. A caller that brings its own colour brings `LABEL`.
 */
export const LABEL = 'text-xs uppercase tracking-widest'

export const HEAD = `${LABEL} text-slate-600`
export const NUMBER = 'font-mono text-xs tabular-nums text-right'
export const GROUP = 'px-3 py-2 text-xs uppercase tracking-widest text-slate-400 bg-slate-900/40'
export const STICKY = 'sticky top-12 z-[5] py-2 bg-slate-950/95 backdrop-blur'
export const TABLE = 'border-y border-slate-800 divide-y divide-slate-900'

/** The filter field. Sized to the longest thing anyone types into it, which is an arm label. */
export const FIELD =
    'w-72 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 text-sm text-slate-200 ' +
    'placeholder:text-slate-600 focus:border-sky-800 focus:outline-none'

export const CHIP = 'rounded border px-2 py-0.5 text-xs border-slate-800 text-slate-500 hover:text-slate-300'
export const CHIP_ON = 'rounded border px-2 py-0.5 text-xs border-sky-800 bg-sky-950 text-sky-300'

/**
 * A control beside the filter — the FILLED one, against the outlined button on a row.
 *
 * Here rather than reached for from `demos/dom.ts`, which carries the same string: that file is the
 * furniture for the inside of a CASE and this is the furniture around a TABLE, which is the seam this
 * package is laid out along. The site's other controls — `FIELD`, `CHIP` — are here for the same
 * reason, and a page that reached across for one of them would be the exception rather than the rule.
 */
export const BUTTON =
    'rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 ' +
    'active:bg-slate-600 border border-slate-700'

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

/**
 * A query, as the TERMS it is made of — split on whitespace, lowered, empties dropped.
 *
 * Taken apart once per keystroke rather than once per row, which is the whole reason it is its own
 * function: `matches` runs sixty times for every character typed and has no business re-parsing the
 * same string sixty times to do it.
 */
export function terms(query: string): string[] {
    const out: string[] = []
    for (const term of query.toLowerCase().split(/\s+/)) if (term !== '') out.push(term)
    return out
}

/**
 * Does this text match EVERY term? Empty query matches everything.
 *
 * All terms rather than any, because narrowing is what a filter is for: `hydrate 10000` should leave
 * one row rather than sixty.
 *
 * Takes the haystack rather than the row: two tables filter with it now and they are searched by
 * different things — an arm label on `/bench`, a case's note on `/tests` — so what a row is WORTH
 * SEARCHING is the caller's, and only the matching is shared.
 */
export function matches(haystack: string, forTerms: string[]): boolean {
    if (forTerms.length === 0) return true
    const lowered = haystack.toLowerCase()
    for (const term of forTerms) if (!lowered.includes(term)) return false
    return true
}

/**
 * A measurement, as the text somebody would search for it by — its ARMS included.
 *
 * A reader looking for `innerHTML` is looking for the arm that spells it, and no title on the page
 * does.
 */
export function benchText(row: BenchRow): string {
    let text = `${row.suite} ${row.title} ${row.kind}`
    for (const arm of row.arms) text += ` ${arm.label}`
    return text
}

/** A claim, as the text somebody would search for it by. The note is in it — it is where the words are. */
export function caseText(spec: Case, suite: string): string {
    return spec.note === undefined ? `${suite} ${spec.title}` : `${suite} ${spec.title} ${spec.note}`
}

/** Is this URL segment a suite? Both tables answer a `[suite]` route and both may be handed nonsense. */
export function isSuite(name: string): name is SuiteName {
    return (ORDER as string[]).includes(name)
}
