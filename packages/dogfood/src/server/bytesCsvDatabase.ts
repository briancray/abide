// The app data this example stands on.

export type Row = { name: string; total: string }

const BY_YEAR: Record<string, Row[]> = {
    '2026': [
        { name: 'north', total: '12480.00' },
        { name: 'south', total: '9140.00' },
        { name: 'east', total: '7020.00' },
    ],
}

/** A cursor over the rows, so the file is written as they are read. */
export const bytesCsvDatabase = {
    sales: {
        async *byRegion(year: number): AsyncGenerator<Row> {
            for (const row of BY_YEAR[String(year)] ?? []) {
                await Bun.sleep(300)
                yield row
            }
        },
    },
}
