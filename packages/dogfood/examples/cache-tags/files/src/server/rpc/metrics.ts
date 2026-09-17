import { GET, reactive } from 'abide/server'
import { database } from '#server/database'

type Region = { region: string }

// The function form receives the entry's args, so a tag can name
// the ROW rather than the query.
const totalsFor = reactive((args: Region) => database.metrics.totals(args), {
    tags: ({ region }) => ['metrics', `region:${region}`],
})

const ordersFor = reactive((args: Region) => database.orders.recent(args), {
    tags: ({ region }) => ['orders', `region:${region}`],
})

export const getTotals = GET(totalsFor)
export const getOrders = GET(ordersFor)
