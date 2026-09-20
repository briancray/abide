// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// ONE REGION STALLS PAST THE HANDLER'S 2 s, and that is the example: a timeout
// is per CHUNK rather than over the whole stream, so a report that keeps
// producing rows runs as long as it likes and one that goes quiet is cut off.
// `south` is the quiet one, and without it the page has no way to show the
// second half of the clause.
//
// THE ROWS THEMSELVES DO NOT SLEEP, and only the stall does. `north` is what
// the page selects on mount, so a per-row delay would be paid by `corpusRuns` —
// which drains for 300 ms and then counts — on every run, and the stall is
// never reached there because nothing clicks `south`.

export type Row = { name: string; total: string }

const BY_REGION: Record<string, Row[]> = {
    north: [
        { name: 'week 1', total: '$3,120.00' },
        { name: 'week 2', total: '$2,980.00' },
        { name: 'week 3', total: '$3,400.00' },
    ],
    south: [{ name: 'week 1', total: '$2,140.00' }],
}

export const database = {
    sales: {
        async *stream(region: string): AsyncGenerator<Row> {
            for (const row of BY_REGION[region] ?? []) yield row
            // The stall the per-chunk timeout is against, on one region only. A
            // bare promise rather than `Bun.sleep`, so the example needs no
            // runtime types to typecheck.
            if (region === 'south')
                await new Promise((resolve) => setTimeout(resolve, 5_000))
        },
    },
}
