import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { OUTBOX_ENABLED } from '../../shared/flags.ts'

/* Durability declared through an imported const, not an inline literal — the regex misses it,
   the checker resolves `OUTBOX_ENABLED` to the literal `true`. */
export const importedOutbox = POST(async (a) => json(a), { outbox: OUTBOX_ENABLED })
