import { POST } from '@belte/belte/server/POST'
import { redirect } from '@belte/belte/server/redirect'
import { destroySession } from '../../sessions.ts'

/*
Drops the server-side session and expires the cookie via
`cookies().delete(...)` — the expiry flushes as `Set-Cookie` when the
handler returns, alongside the 303 redirect.
*/
export const logout = POST(() => {
    destroySession()
    return redirect('/', 303)
})
