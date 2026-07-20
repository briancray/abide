import { error } from "abide/server/error"
import { POST } from "abide/server/POST"

// A mutating RPC returning a NAMED, narrowable typed error. `error.typed(name, status)` builds a
// factory whose body carries the type name + payload; the browser catches it as an HttpError whose
// `kind` is the type name, so callers can narrow the failure ("RateLimited") from any other error.
const rateLimited = error.typed("RateLimited", 429)

export default POST(({ tokens = 0 }: { tokens?: number }) => {
  if (tokens > 0) return { ok: true, tokens }
  return rateLimited({ retryAfter: 30 })
})
