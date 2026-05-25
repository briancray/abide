import { GET } from 'belte/route'
import { redirect } from 'belte/respond'

/*
GET that returns a redirect via belte/respond. The `redirect()` helper
accepts relative URLs (`Response.redirect` throws on them) and defaults
to 302.
*/
export const redirectExample = GET<undefined, undefined>(() => redirect('/respond/response-helpers'))
