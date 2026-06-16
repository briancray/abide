import { GET } from '@abide/abide/server/GET'
import { redirect } from '@abide/abide/server/redirect'

/*
GET that returns a redirect via abide/server. The `redirect()` helper
accepts relative URLs (`Response.redirect` throws on them) and defaults
to 302. Used by the demo at /rpc/respond; target is /rpc
so the redirect lands somewhere visibly different from the demo page.
*/
export const redirectExample = GET(() => redirect('/rpc'))
