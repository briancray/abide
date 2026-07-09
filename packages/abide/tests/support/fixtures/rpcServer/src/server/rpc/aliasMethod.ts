import { GET as read } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* The helper is imported under an alias, so the `RPC_EXPORT` regex — keyed on a literal
   `GET(`/`POST(` — reads no method. The symbol query follows the alias back to `GET`. */
export const aliasMethod = read(() => json({ ok: true }))
