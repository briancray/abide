import { error } from '@briancray/belte/server/error'
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

/*
Stand-in for a products table. Used by /rpc/product/[id] to show how a
dynamic page segment threads through to an rpc arg. `error(404, ...)` from
belte/server keeps the response shape consistent with HttpError on the
caller side — `getProduct({ id }).catch((e) => e.status)` sees 404.
Schema auto-exposes this rpc to MCP + CLI.
*/
const products: Record<string, { id: string; name: string; price: number }> = {
    '1': { id: '1', name: 'Stroopwafel', price: 4 },
    '2': { id: '2', name: 'Speculaas', price: 3 },
}

const schema = z.object({ id: z.string() })

export const getProduct = GET(
    ({ id }) => {
        const product = products[id]
        if (!product) {
            return error(404, `no product with id ${id}`)
        }
        return json(product)
    },
    { schema },
)
