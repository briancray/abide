import { GET } from 'abide/server'
import { database } from '#server/timeoutPerChunkDatabase'

export const salesByRegion = GET(
    async function* ({ region }: { region: string }) {
        for await (const row of database.sales.stream(region)) yield row
    },
    { timeout: 2_000 },
)
