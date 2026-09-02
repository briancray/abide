import { GET, memo } from 'abide/server'
import { database } from '#server/database'

// A body that TAKES ARGS is keyed: one entry per args key,
// computed on the first read of that key and held. It is
// UNTRACKED — its ways back are `ttl`, an explicit `invalidate`
// or `refresh`, and eviction.
const customerById = memo(
    ({ id }: { id: string }) => database.customer.find(id),
    { ttl: 30_000 },
)

// A second memo about the same customer. The function form
// receives the memo's args, so a tag can name the ROW rather
// than the query.
const invoicesForCustomer = memo(
    ({ id }: { id: string }) => database.invoice.forCustomer(id),
    { tags: ({ id }) => ['invoice', `customer:${id}`] },
)

export const getCustomer = GET(customerById)
export const getInvoices = GET(invoicesForCustomer)
