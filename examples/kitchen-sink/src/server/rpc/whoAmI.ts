import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { request } from '@abide/abide/server/request'

/*
Demonstrates the `request()` helper from abide/server. The same `request()`
call works from any module under the request scope (rpc handler, page
script, layout, downstream helper) because it's backed by AsyncLocalStorage
— no plumbing through function arguments.
*/
export const whoAmI = GET(() => {
    const headers = request().headers
    return json({
        hasCookie: headers.has('cookie'),
        userAgent: headers.get('user-agent'),
    })
})
