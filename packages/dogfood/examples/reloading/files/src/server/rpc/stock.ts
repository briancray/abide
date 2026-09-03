import { GET, POST, invalidate, memo } from 'abide/server'
import { database } from '#server/database'

type Shelf = { warehouse: string; sku: string }

// `ttl` is the life of a RETAINED PRODUCTION: past it the producer
// recomputes on the next read. Expiry wakes nobody — an entry past
// it is dropped on the read that follows rather than by a timer,
// which is what keeps retention off the write.
//
// `global` because a shelf count is a fact and not an answer about
// who asked, so one load serves every caller — and it is what
// gives the triggers below something that outlives a request.
const stockForShelf = memo(
    ({ warehouse, sku }: Shelf) => database.stock.find(warehouse, sku),
    {
        global: true,
        ttl: 30_000,
        tags: ({ warehouse, sku }) => ['stock', `sku:${sku}`, warehouse],
    },
)

export const getStock = GET(stockForShelf)

// A write, then the entries it made stale. A pattern is a
// `Partial<Args>`, so `{ sku }` names that shelf in every
// warehouse.
//
// `invalidate` and not `refresh`: NOTHING HERE IS DISPLAYING THE
// VALUE, and a `refresh()` with no reader to serve degenerates to
// exactly this. The caller whose page is showing the number does
// its own, in its own scope.
export const bookOut = POST(async ({ warehouse, sku }: Shelf) => {
    await database.stock.decrement(warehouse, sku)
    getStock.invalidate({ sku })
    return database.stock.find(warehouse, sku)
})

// An operator's flush, and the shape that wants the wide form. A
// selection is scope-bounded, so on a server this reaches the
// `global` entries above plus its own request's — and the
// request's die with it anyway, so the globals are the whole
// effect.
export const flushStock = POST(() => invalidate({ tags: ['stock'] }))
