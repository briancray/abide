import { GET, reactive } from 'abide/server'
import { database } from '#server/cacheTagsDatabase'

type Region = { region: string }

/** A tag function gets the entry's args, so a tag can name the row. */
const totalsFor = reactive((args: Region) => database.metrics.totals(args), {
    tags: ({ region }) => ['metrics', `region:${region}`],
})

const ordersFor = reactive((args: Region) => database.orders.recent(args), {
    tags: ({ region }) => ['orders', `region:${region}`],
})

export const getTotals = GET(totalsFor)
export const getOrders = GET(ordersFor)
