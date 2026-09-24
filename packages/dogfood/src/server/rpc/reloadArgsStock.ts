import { GET, POST, reactive } from 'abide/server'
import { database } from '#server/reloadArgsDatabase'

type Shelf = { warehouse: string; sku: string }

const stockForShelf = reactive(({ warehouse, sku }: Shelf) => {
    return database.stock.find(warehouse, sku)
})

export const getStock = GET(stockForShelf)

export const bookOut = POST(async ({ warehouse, sku }: Shelf) => {
    await database.stock.decrement(warehouse, sku)
    // The process-wide entry, so the next CALLER loads fresh.
    stockForShelf.invalidate({ warehouse, sku })
})
