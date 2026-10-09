import { GET, reactive } from 'abide/server'
import { reloadTriggersDatabase } from '#server/reloadTriggersDatabase'

type Shelf = { warehouse: string; sku: string }

const stockForShelf = reactive(({ warehouse, sku }: Shelf) => {
    return reloadTriggersDatabase.stock.find(warehouse, sku)
})

export const getStock = GET(stockForShelf, {
    description: 'Stock on a shelf, by warehouse and sku.',
})
