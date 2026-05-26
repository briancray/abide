import { redirect } from 'belte/respond'
import { GET } from 'belte/route'

/*
GET that returns a redirect via belte/respond. The `redirect()` helper
accepts relative URLs (`Response.redirect` throws on them) and defaults
to 302. Used by the demo at /respond/response-helpers; target is /route
so the redirect lands somewhere visibly different from the demo page.
*/
export const redirectExample = GET(() => redirect('/route'))
