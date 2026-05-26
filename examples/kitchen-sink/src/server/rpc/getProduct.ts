import { error, json } from 'belte/server'
import { GET } from 'belte/server'

/*
Stand-in for a products table. Used by /rpc/product/[id] to show how a
dynamic page segment threads through to an rpc arg. `error(404, ...)` from
belte/server keeps the response shape consistent with HttpError on the
caller side — `getProduct({ id }).catch((e) => e.status)` sees 404.
*/
const products: Record<string, { id: string; name: string; price: number }> = {
    '1': { id: '1', name: 'Stroopwafel', price: 4 },
    '2': { id: '2', name: 'Speculaas', price: 3 },
}

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) {
        return error(404, `no product with id ${id}`)
    }
    return json(product)
})
