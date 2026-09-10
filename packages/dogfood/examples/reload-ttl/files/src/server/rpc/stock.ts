import { GET, memo } from 'abide/server'
import { database } from '#server/database'

type Shelf = { warehouse: string; sku: string }

// The life of a retained production. Past it, the producer
// recomputes on the next READ — nothing wakes when it lapses.
const stockForShelf = memo(
    ({ warehouse, sku }: Shelf) => database.stock.find(warehouse, sku),
    { ttl: 3_000 },
)

export const getStock = GET(stockForShelf)
