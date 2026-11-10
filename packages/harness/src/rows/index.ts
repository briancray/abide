// WHAT A ROW RUNNER WRITES AND A PAGE READS. A runner is a subprocess printing one JSON row per
// line; the docs app pipes those lines to the page without reading them, so this module is the
// whole of the contract between the two packages.
//
// PURE, AND IMPORTED BY THE PAGE: the filter a reader types and the filter the runner applies are
// this one function, so "run what I can see" runs exactly the rows on screen.

export type RowItem = { id: string; section: string; name: string }

/**
 * Where a row is in its run.
 *
 * `broken` is the RUNNER failing — no report, or a suite stopped at its deadline (43.27) — and is
 * not a red result.
 */
export type RowState = 'queued' | 'running' | 'done' | 'broken'

export type TestRow = {
    id: string
    state: RowState
    tests: number
    failures: number
    skipped: number
    milliseconds: number
    /** Every test the file ran, in the order its report lists them. */
    cases: TestCase[]
    note: string
}

/**
 * One test in a file, as its report gave it.
 *
 * A failure carries the message the runner wrote.
 */
export type TestCase = {
    name: string
    milliseconds: number
    skipped: boolean
    failure: string | null
}

/**
 * Whether `item` falls in `scope`: `all`, `section:<name>`, `item:<id>`, or nothing at all.
 *
 * The page's first render asks for nothing, so a reader who opened the page has not started a run.
 */
export function inScope(item: RowItem, scope: string): boolean {
    if (scope === 'all') return true
    if (scope.startsWith('section:'))
        return item.section === scope.slice('section:'.length)
    if (scope.startsWith('item:'))
        return item.id === scope.slice('item:'.length)
    return false
}

/** Whether the typed filter is a case-insensitive substring of the item's section and name. */
export function matchesFilter(item: RowItem, filter: string): boolean {
    const wanted = filter.trim().toLowerCase()
    return (
        wanted === '' ||
        `${item.section} ${item.name}`.toLowerCase().includes(wanted)
    )
}
