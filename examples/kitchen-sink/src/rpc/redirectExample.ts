import { GET } from 'belte/rpc'
import { redirect } from 'belte/response'

/*
GET that returns a redirect via belte/response. The `redirect()` helper
accepts relative URLs (`Response.redirect` throws on them) and defaults
to 302.
*/
export const redirectExample = GET<undefined, undefined>(() => redirect('/reply/response-helpers'))
