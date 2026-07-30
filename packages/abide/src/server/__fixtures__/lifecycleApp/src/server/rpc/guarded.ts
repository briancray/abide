// An rpc that DECLARES middleware, for the one claim `ping` cannot support: that a read reaching this
// app from a non-HTTP door still runs the rpc's own chain.
//
// `abide run` binds no server and never calls `createApp`, which is where the chain used to be installed —
// so a migration's reads went straight to the handler, past every guard the rpc declared. The middleware
// records into `process.env` because that is how the rest of this fixture reports (the assertion runs in
// the parent, the middleware runs inside the loaded app).

import { GET } from 'abide/server/GET'

export default GET(() => ({ ok: true }), {
    middleware: [
        (next) => {
            process.env.__ABIDE_GUARD = String(Number(process.env.__ABIDE_GUARD ?? '0') + 1)
            return next()
        },
    ],
})
