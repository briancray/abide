import { GET } from 'abide/server'
import { timeoutPerChunkDatabase } from '#server/timeoutPerChunkDatabase'

export const salesByRegion = GET(
    async function* ({ region }: { region: string }) {
        for await (const row of timeoutPerChunkDatabase.sales.stream(region))
            yield row
    },
    { timeout: 2_000, description: 'Sales for a region, a row at a time.' },
)
