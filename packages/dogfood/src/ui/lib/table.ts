// The names a table of cases and a table of measurements share.
//
// These used to be Tailwind class STRINGS — a column template, a colour, a sticky offset — repeated
// into every component that drew a row. They are component classes now: `app.css` carries the column
// templates in `@layer base` and the look in `@layer components`, so a header drifting from the rows
// under it is a drift inside one rule rather than between two strings in two files.
//
// The seam this file states has not moved: `/tests` reports a status per case and `/bench` reports
// four numbers per arm, so the two tables keep their own column templates and share everything
// around them.

import type { BenchRow, Status } from 'harness'

/**
 * The badge's ramp. `waiting` and `running` are deliberately quiet — neither is news.
 *
 * A STATE, not a colour: `.badge.is-failed` is one rule in `app.css`, so the emit-order hazard that
 * used to sit here — two `color` utilities on one element, settled by the order Tailwind wrote them
 * rather than the order the attribute lists them, which turned every status grey — cannot arise.
 *
 * Here rather than on `case-row.abide` because a second component paints a status now: a rung's
 * proofs on `/docs`. Two copies of a seven-entry map is how one of them grows a state the other
 * does not have.
 */
export const TONE: Record<Status, string> = {
    waiting: 'is-waiting',
    running: 'is-running',
    passing: 'is-passing',
    failed: 'is-failed',
    interactive: 'is-interactive',
    benched: 'is-benched',
    server: 'is-server',
}

export const LINE: Record<'note' | 'pass' | 'fail', string> = {
    note: 'is-note',
    pass: 'is-pass',
    fail: 'is-fail',
}

/** The bench table's columns — the sticky header and the summary rows under it, one template. */
export const BENCH_ROW = 'bench-row'

/** The ARM table inside a row, deliberately NOT `BENCH_ROW`: a distribution, not a comparison. */
export const BENCH_ARM = 'arm-row'

/** The case table's columns: the disclosure chevron, what is claimed, and the status. */
export const CASE_ROW = 'case-row'

/**
 * The typography every column heading shares, with NO colour in it.
 *
 * It stays separate from `HEAD` for the reason it always did — a caller that brings its own colour
 * brings this — but the Tailwind emit-order hazard behind that rule is gone: these are component
 * classes now, and a colour set on `.badge.is-failed` cannot lose to one set on `.head`.
 */
export const LABEL = 'label'

export const HEAD = 'head'
export const NUMBER = 'number'
export const GROUP = 'group-head'

/**
 * The row of column names. It no longer PINS — `.table-top`, the block holding it and the toolbar
 * above it, is what does, on the line the sidebar starts at. See `app.css`.
 */
export const HEAD_ROW = 'table-head'
export const TABLE = 'datatable'

/** The filter field. Sized to the longest thing anyone types into it, which is an arm label. */
export const FIELD = 'field'

export const CHIP = 'chip'
export const CHIP_ON = 'chip is-on'

/** A run of text a term matched. On a `<mark>`, so what it means survives the colour being taken off. */
export const HIT = 'hit'

/** A control beside the filter — the FILLED one, against the outlined button on a row. */
export const BUTTON = 'button'

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
 * different things — a whole `benchText` on `/bench`, the CLAIM TITLE and nothing else on `/tests` —
 * so what a row is worth searching is the caller's, and only the matching is shared.
 */
export function matches(haystack: string, forTerms: string[]): boolean {
    if (forTerms.length === 0) return true
    const lowered = haystack.toLowerCase()
    for (const term of forTerms) if (!lowered.includes(term)) return false
    return true
}

/** A run of one text, and whether a term is what it is. `marked` is what cuts them. */
export interface Segment {
    text: string
    hit: boolean
}

/**
 * One text cut into the runs a term matched and the runs it did not — `matches` said WHETHER, this
 * says WHERE.
 *
 * The narrowing is otherwise invisible: a query that leaves sixty rows leaves them looking exactly
 * like the three hundred it cut, and the word that decided it is somewhere inside a claim long enough
 * to truncate. All terms are painted rather than the one a reader typed last, because `matches` is an
 * AND — every one of them is why the row is still here.
 *
 * OVERLAPS MERGE, and that is the whole of what is hard about this: `re red` over `reduce` finds
 * `re` at 0 and `red` at 0, and two marks emitted from the same characters is the text written twice.
 * They are collected, sorted by where they start, and absorbed while the next one begins inside the
 * run being built — so `a` and `ab` are one mark, and so are `ab` and `bc`.
 *
 * Every term is found EVERYWHERE rather than once, since `hydrate` in a title and again in a note is
 * two answers to the same question.
 */
export function marked(text: string, forTerms: string[]): Segment[] {
    if (forTerms.length === 0) return [{ text, hit: false }]
    const lowered = text.toLowerCase()
    const found: { start: number; end: number }[] = []
    for (const term of forTerms) {
        let at = lowered.indexOf(term)
        while (at !== -1) {
            found.push({ start: at, end: at + term.length })
            at = lowered.indexOf(term, at + term.length)
        }
    }
    if (found.length === 0) return [{ text, hit: false }]

    found.sort((a, b) => a.start - b.start)
    const out: Segment[] = []
    let cut = 0
    for (let i = 0; i < found.length; i++) {
        const range = found[i] as { start: number; end: number }
        let end = range.end
        // Sorted by start, so everything overlapping this run is the next one, and then the next.
        while (i + 1 < found.length) {
            const next = found[i + 1] as { start: number; end: number }
            if (next.start > end) break
            if (next.end > end) end = next.end
            i++
        }
        if (range.start > cut) out.push({ text: text.slice(cut, range.start), hit: false })
        out.push({ text: text.slice(range.start, end), hit: true })
        cut = end
    }
    if (cut < text.length) out.push({ text: text.slice(cut), hit: false })
    return out
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

