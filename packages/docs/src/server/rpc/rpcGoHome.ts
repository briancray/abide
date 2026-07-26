import { GET } from 'abide/server/GET'
import { redirect } from 'abide/server/redirect'

// A read RPC that returns a `redirect` Response. The wire carries `302 Found` + `Location` (curl -i
// shows it); a browser fetch either FOLLOWS it — which is what the redirect demo observes, via
// `response.redirected` and the final `url` — or, with `redirect: "manual"`, resolves to an opaque
// response that withholds the status and headers from JS. Both are shown on /rpc/responses.
export default GET(({ to = '/rpc' }) => redirect(to, 302))
