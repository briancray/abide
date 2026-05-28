import { GET } from 'belte/server/GET'
import { redirect } from 'belte/server/redirect'

/*
GET that returns a redirect via belte/server. The `redirect()` helper
accepts relative URLs (`Response.redirect` throws on them) and defaults
to 302. Used by the demo at /respond/response-helpers; target is /rpc
so the redirect lands somewhere visibly different from the demo page.
*/
export const redirectExample = GET(() => redirect('/rpc'))
