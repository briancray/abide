import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { z } from 'zod'

/* quantity must be a positive integer — a 0/missing/negative fails validation (422). */
const inputSchema = z.object({
    sku: z.string(),
    quantity: z.coerce.number().int().min(1),
})

/*
A declared error set: each named error names its HTTP status + an optional data
schema the constructor requires. The client derives a typed Result union from
this, and the handler receives matching constructors via its second arg.
*/
const errors = {
    outOfStock: { status: 409, data: z.object({ sku: z.string(), available: z.number() }) },
} as const

const STOCK: Record<string, number> = { 'abide-tee': 2, 'abide-mug': 0 }

/*
Two typed failure modes on one rpc, both surfacing as an HttpError with
`.kind` / `.data` on the client:
- a bad quantity fails inputSchema → `kind: 'validation'` (422), data is ValidationErrorData
- an over-order returns `error(errors.outOfStock(...))` → `kind: 'outOfStock'` (409),
  data is the `{ sku, available }` the constructor carried
*/
export const checkout = POST(
    ({ sku, quantity }, { errors }) => {
        const available = STOCK[sku] ?? 0
        if (quantity > available) {
            return error(errors.outOfStock({ sku, available }))
        }
        return json({ ok: true as const, sku, quantity })
    },
    { inputSchema, errors },
)
