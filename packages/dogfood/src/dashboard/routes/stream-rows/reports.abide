import { GET } from '@abide/abide/server'
import { streamRowsDatabase } from '#server/streamRowsDatabase'

export const salesByRegion = GET(
    async function* ({ year }: { year: number }) {
        for await (const row of streamRowsDatabase.sales.byRegion(year))
            yield row
    },
    { description: 'Sales by region for a year, a row at a time.' },
)
