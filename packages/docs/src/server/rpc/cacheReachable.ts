import { GET } from 'abide/server/GET'
import { request } from 'abide/server/request'
import { reachable } from 'abide/shared/reachable'

// Demonstrates `reachable(host)` from the isomorphic surface: probes the app's own origin (answers,
// so → true) and a dead local port (refused, so → false). Called from the browser via the RPC, it
// shows both branches of an active reachability probe without depending on the public internet.
export default GET(async () => {
    const origin = new URL(request().url).origin
    const self = await reachable(origin)
    const dead = await reachable('http://127.0.0.1:9')
    return { self, dead }
})
