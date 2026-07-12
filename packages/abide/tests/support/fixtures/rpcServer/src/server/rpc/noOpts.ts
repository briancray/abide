import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* No opts — the client module needs nothing but the bare `remoteProxy` call, so the keep plan is
   empty and the `json` import (handler-only) drops. */
export const noOpts = GET(() => json({ ok: true }))
