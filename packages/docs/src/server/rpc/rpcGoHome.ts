import { GET } from 'abide/server/GET'
import { redirect } from 'abide/server/redirect'

// A read RPC that returns a `redirect` Response. Fetched from the browser with `redirect: "manual"`
// the demo can observe the 302 status and the Location header without following it.
export default GET(({ to = '/rpc' }: { to?: string }) => redirect(to, 302))
