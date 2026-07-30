import { context } from 'abide/server/context'
import { GET } from 'abide/server/GET'

// A per-RPC middleware. This is the PER-READ rung: it runs on every read of this rpc, from whichever door
// the read came through — the browser's fetch, this app's own page render, a handler reading it as a
// sibling, an `abide run` migration. `src/app.ts`'s `middleware` array is the other rung, per REQUEST.
//
// `middleware` is not only auth. It is `(next) => Response`, so tracing, rate limiting and filling the
// per-request carrier bag are all the same shape — which is why a read that skips it is not merely
// unauthorized, it is unobserved. Short-circuit by calling `error(403)` instead of `next()`.
const stamp = (next: () => Response | Promise<Response>): Response | Promise<Response> => {
    context().greetedBy = 'greet.middleware'
    return next()
}

// One GET RPC with a type-DERIVED schema (no hand-written schema) — CL1.2.
export default GET(
    ({ name }: { name: string }) => {
        // Reading back what the middleware wrote is the hand-off from a middleware layer to the handler,
        // and it is what lets the smoke test prove the rung ran on the SSR door and not only over HTTP.
        const by = context().greetedBy
        return typeof by === 'string' ? `Hello, ${name}!` : `Hello, ${name}? (ungreeted)`
    },
    { middleware: [stamp] },
)
