import { GET, memo } from 'abide/server'
import { database } from '#server/database'

type Region = { region: string }

// The function form receives the memo's args, so a tag can name
// the ROW rather than the query.
const totalsFor = memo((args: Region) => database.metrics.totals(args), {
    tags: ({ region }) => ['metrics', `region:${region}`],
})

const ordersFor = memo((args: Region) => database.orders.recent(args), {
    tags: ({ region }) => ['orders', `region:${region}`],
})

export const getTotals = GET(totalsFor)
export const getOrders = GET(ordersFor)
