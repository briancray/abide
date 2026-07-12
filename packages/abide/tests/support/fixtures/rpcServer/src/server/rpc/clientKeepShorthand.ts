import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { crossOriginEnabled as crossOrigin } from '../lib/policy.ts'

/* `opts` is the shorthand `{ crossOrigin }`; the aliased import must survive because opts references
   it, even though a plain identifier scan of a shorthand resolves to the property symbol. */
export const clientKeepShorthand = GET(() => json({ ok: true }), { crossOrigin })
