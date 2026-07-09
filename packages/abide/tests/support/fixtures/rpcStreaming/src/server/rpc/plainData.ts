import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* Plain JSON handler — not streaming under either detector. */
export const plainData = GET(() => json({ ok: true }))
