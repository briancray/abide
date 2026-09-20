// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// AN ASYNC ITERABLE, AND NO SLEEP IN IT. A gap between rows would read better
// on the card — rows appearing as they land is the page's claim — but
// `corpusRuns` drains for 300 ms and then counts, so a fixture slower than the
// drain decides whether this file is scored as running. The yields still cross
// turns, which is the path the example is about; the wall clock is not.

export type Row = { name: string; total: string }

const BY_YEAR: Record<string, Row[]> = {
    '2026': [
        { name: 'north', total: '$12,480.00' },
        { name: 'south', total: '$9,140.00' },
        { name: 'east', total: '$7,020.00' },
    ],
}

export const database = {
    sales: {
        async *byRegion(year: number): AsyncGenerator<Row> {
            for (const row of BY_YEAR[String(year)] ?? []) yield row
        },
    },
}
