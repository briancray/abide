import { error } from "abide/server/error"
import { GET } from "abide/server/GET"

// A read that fails on demand so the `error` probe can be exercised: `{ fail: true }` returns a 400
// (the client proxy surfaces it as an HttpError the `error` probe holds), otherwise it succeeds.
export default GET(({ fail = false }: { fail?: boolean }) => {
  if (fail) return error(400, "flaky boom")
  return { ok: true }
})
