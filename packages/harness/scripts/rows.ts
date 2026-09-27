// WHAT THE BENCH AND TESTS PAGES READ, AND WHAT THE TWO RUNNERS WRITE. Both runners are
// subprocesses printing one JSON row per line; the docs app pipes those lines to the page without
// reading them, so this module is the whole of the contract between the two packages.
//
// PURE, AND IMPORTED BY THE PAGE: the filter a reader types and the filter the runner applies are
// this one function, so "run what I can see" runs exactly the rows on screen.

export type RowItem = { id: string; section: string; name: string }

// `broken` is the RUNNER failing — no report, a thrown bench — and is not a red result.
export type RowState = 'queued' | 'running' | 'done' | 'broken'

export type BenchRow = {
    id: string
    state: RowState
    unit: string
    abide: number | null
    vanilla: number | null
    // abide / vanilla as the lane is allowed to say it: a number, or why there is none.
    claim: string
    note: string
}

export type TestRow = {
    id: string
    state: RowState
    tests: number
    failures: number
    skipped: number
    milliseconds: number
    failed: { name: string; failure: string }[]
    note: string
}

// A RUNNER THAT DIED PART WAY, as the line the docs app writes after the rows it did send: a stream
// whose head has gone out cannot fail with a status, and cut off it reads as a network error that
// says nothing of the runner's own.
export type RunnerFailure = { failure: string }

export function isRunnerFailure(line: object): line is RunnerFailure {
    return typeof (line as { failure?: unknown }).failure === 'string'
}

// `all`, `section:<name>`, `item:<id>`, or nothing at all — the page's first render asks for
// nothing, so a reader who opened the page has not started a run.
export function inScope(item: RowItem, scope: string): boolean {
    if (scope === 'all') return true
    if (scope.startsWith('section:'))
        return item.section === scope.slice('section:'.length)
    if (scope.startsWith('item:'))
        return item.id === scope.slice('item:'.length)
    return false
}

export function matchesFilter(item: RowItem, filter: string): boolean {
    const wanted = filter.trim().toLowerCase()
    return (
        wanted === '' ||
        `${item.section} ${item.name}`.toLowerCase().includes(wanted)
    )
}
