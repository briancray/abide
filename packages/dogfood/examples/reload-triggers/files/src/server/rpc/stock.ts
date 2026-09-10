import { GET, memo } from 'abide/server'
import { database } from '#server/database'

type Shelf = { warehouse: string; sku: string }

const stockForShelf = memo(({ warehouse, sku }: Shelf) => {
    return database.stock.find(warehouse, sku)
})

export const getStock = GET(stockForShelf)
