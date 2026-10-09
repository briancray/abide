import { GET, reactive } from 'abide/server'
import { cacheTagsDatabase } from '#server/cacheTagsDatabase'

type Region = { region: string }

/** A tag function gets the entry's args, so a tag can name the row. */
const totalsFor = reactive(
    (args: Region) => cacheTagsDatabase.metrics.totals(args),
    {
        tags: ({ region }) => ['metrics', `region:${region}`],
    },
)

const ordersFor = reactive(
    (args: Region) => cacheTagsDatabase.orders.recent(args),
    {
        tags: ({ region }) => ['orders', `region:${region}`],
    },
)

export const getTotals = GET(totalsFor, {
    description: 'Order totals for a region.',
})
export const getOrders = GET(ordersFor, {
    description: 'Recent orders for a region.',
})
