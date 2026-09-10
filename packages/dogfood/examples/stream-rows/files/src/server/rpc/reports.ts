import { GET } from 'abide/server'
import { database } from '#server/database'

export const salesByRegion = GET(async function* ({ year }: { year: number }) {
    for await (const row of database.sales.byRegion(year)) yield row
})
