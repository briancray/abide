import { error } from "abide/server/error"
import { POST } from "abide/server/POST"

// A mutating RPC that returns a plain `error(status, message)` Response. Called from the browser it
// surfaces as a thrown HttpError (status/statusText/message) the caller can catch.
export default POST(({ ok = false }: { ok?: boolean }) => {
  if (ok) return { ok: true }
  return error(422, "note text is required")
})
