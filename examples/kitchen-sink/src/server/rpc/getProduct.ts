import { error } from '@abide/abide/server/error'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

/*
Stand-in for a products table. Used by /pages/product/[id] to show how a
dynamic page segment threads through to an rpc arg. `error(404, ...)` from
abide/server keeps the response shape consistent with HttpError on the
caller side — `getProduct({ id }).catch((e) => e.status)` sees 404.
The `inputSchema` auto-exposes this rpc to MCP + CLI; the `outputSchema`
describes the success body, feeding the OpenAPI 200 response and the MCP
tool's output schema (see /openapi.json and /mcp).
*/
const products: Record<string, { id: string; name: string; price: number }> = {
    '1': { id: '1', name: 'Stroopwafel', price: 4 },
    '2': { id: '2', name: 'Speculaas', price: 3 },
}

const inputSchema = z.object({ id: z.string() })
const outputSchema = z.object({ id: z.string(), name: z.string(), price: z.number() })

export const getProduct = GET(
    ({ id }) => {
        const product = products[id]
        if (!product) {
            return error(404, `no product with id ${id}`)
        }
        return json(product)
    },
    { inputSchema, outputSchema },
)
