import { GET, POST, reactive } from 'abide/server'
import { reloadArgsDatabase } from '#server/reloadArgsDatabase'

type Shelf = { warehouse: string; sku: string }

const stockForShelf = reactive(({ warehouse, sku }: Shelf) => {
    return reloadArgsDatabase.stock.find(warehouse, sku)
})

export const getStock = GET(stockForShelf, {
    description: 'Stock on a shelf, by warehouse and sku.',
})

export const bookOut = POST(
    async ({ warehouse, sku }: Shelf) => {
        await reloadArgsDatabase.stock.decrement(warehouse, sku)
        // The process-wide entry, so the next CALLER loads fresh.
        stockForShelf.invalidate({ warehouse, sku })
    },
    { description: 'Books one unit out of a shelf.' },
)
