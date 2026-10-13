// The app data this example stands on.

export type Row = { name: string; total: string }

const BY_YEAR: Record<string, Row[]> = {
    '2026': [
        { name: 'north', total: '$12,480.00' },
        { name: 'south', total: '$9,140.00' },
        { name: 'east', total: '$7,020.00' },
    ],
}

/** A slow database, so each row lands on its own. */
export const streamRowsDatabase = {
    sales: {
        async *byRegion(year: number): AsyncGenerator<Row> {
            for (const row of BY_YEAR[String(year)] ?? []) {
                await Bun.sleep(1200)
                yield row
            }
        },
    },
}
