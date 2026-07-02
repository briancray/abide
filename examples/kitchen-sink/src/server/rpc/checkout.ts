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
A reusable typed error declared at module scope. `error.typed(name, status, schema?)`
names its HTTP status + an optional data schema the constructor requires. Returning it
from the handler IS the error — the rpc infers its whole error surface from the
constructors the handler returns, so there's no `errors:` option and the client derives a
typed `.kind` / `.data` for `checkout.isError(err, 'outOfStock')`.
*/
const outOfStock = error.typed(
    'outOfStock',
    409,
    z.object({ sku: z.string(), available: z.number() }),
)

const STOCK: Record<string, number> = { 'abide-tee': 2, 'abide-mug': 0 }

/*
Two typed failure modes on one rpc, both surfacing as an HttpError with
`.kind` / `.data` on the client:
- a bad quantity fails inputSchema → `kind: 'validation'` (422), data is ValidationErrorData
- an over-order returns `outOfStock({...})` → `kind: 'outOfStock'` (409), data is the
  `{ sku, available }` the constructor carried
*/
export const checkout = POST(
    ({ sku, quantity }) => {
        const available = STOCK[sku] ?? 0
        if (quantity > available) {
            return outOfStock({ sku, available })
        }
        return json({ ok: true as const, sku, quantity })
    },
    { inputSchema },
)
