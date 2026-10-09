import { bytes, GET } from 'abide/server'
import { bytesCsvDatabase } from '#server/bytesCsvDatabase'

const ENCODER = new TextEncoder()

async function* csvOf(year: number): AsyncGenerator<Uint8Array> {
    yield ENCODER.encode('region,total\n')
    for await (const row of bytesCsvDatabase.sales.byRegion(year))
        yield ENCODER.encode(`${row.name},${row.total}\n`)
}

export const salesCsv = GET(
    ({ year }: { year: number }) => bytes(csvOf(year)),
    { description: 'Sales by region for a year, as CSV.' },
)
