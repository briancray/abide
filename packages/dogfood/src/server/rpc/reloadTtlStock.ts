import { GET, reactive } from 'abide/server'
import { reloadTtlDatabase } from '#server/reloadTtlDatabase'

type Shelf = { warehouse: string; sku: string }

/** Past it, the next READ recomputes; nothing wakes when it lapses. */
const stockForShelf = reactive(
    ({ warehouse, sku }: Shelf) => reloadTtlDatabase.stock.find(warehouse, sku),
    { ttl: 3_000 },
)

export const getStock = GET(stockForShelf, {
    description: 'Stock on a shelf, by warehouse and sku.',
})
