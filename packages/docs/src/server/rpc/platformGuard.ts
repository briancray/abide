// #demo platformGuard
import { context } from "abide/server/context"
import { error } from "abide/server/error"
import { GET } from "abide/server/GET"
import { request } from "abide/server/request"

// The RPC middleware ONION, two layers deep. Each layer is `(next) => Response`; it owns the call to
// the layer beneath. `next()` runs the rest of the chain (and eventually the handler).

// Layer 1 — authorize. A GET carries its args as JSON under the `?args=` query param; the middleware
// reads the raw request URL and inspects them. When `allow` is "no" it returns an `error(403)`
// Response WITHOUT calling `next()` — a short-circuit, so layer 2 and the handler never run.
const authorize = (next: () => Response | Promise<Response>) => {
  const raw = new URL(request().url).searchParams.get("args")
  let allow = "yes"
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { allow?: string }
      if (typeof parsed.allow === "string") allow = parsed.allow
    } catch {
      // Malformed args — leave the default and let the handler's own validation handle it.
    }
  }
  if (allow === "no") return error(403, "blocked by middleware")
  return next()
}

// Layer 2 — stamp. Reached only when layer 1 called `next()`. Records who let the request through
// into the per-request `context()` bag, then passes through to the handler.
const stamp = (next: () => Response | Promise<Response>) => {
  context().passedGuard = "platformGuard.authorize"
  return next()
}

// The handler runs only for authorized requests; it reads back the stamp layer 2 left in context().
export default GET(
  ({ allow = "yes" }: { allow?: string }) => {
    const bag = context()
    return {
      allow,
      passedGuard: typeof bag.passedGuard === "string" ? bag.passedGuard : null,
    }
  },
  { middleware: [authorize, stamp] },
)
// #enddemo
