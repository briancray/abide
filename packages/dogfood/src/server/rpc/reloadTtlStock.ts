import { GET, reactive } from 'abide/server'
import { database } from '#server/reloadTtlDatabase'

type Shelf = { warehouse: string; sku: string }

// Past it, the next READ recomputes; nothing wakes when it lapses.
const stockForShelf = reactive(
    ({ warehouse, sku }: Shelf) => database.stock.find(warehouse, sku),
    { ttl: 3_000 },
)

export const getStock = GET(stockForShelf)
