import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { request } from 'belte/server/request'

/*
Demonstrates the `request()` helper from belte/server. The same `request()`
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
