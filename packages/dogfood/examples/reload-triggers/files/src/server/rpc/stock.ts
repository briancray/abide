import { GET, reactive } from 'abide/server'
import { database } from '#server/database'

type Shelf = { warehouse: string; sku: string }

const stockForShelf = reactive(({ warehouse, sku }: Shelf) => {
    return database.stock.find(warehouse, sku)
})

export const getStock = GET(stockForShelf)
