import { POST } from "abide/server/POST"
import { invalidate } from "abide/shared/invalidate"

// Drives the GLOBAL tag verb `invalidate({ tags })` — the only global cache-verb form. It is a
// SERVER concept: the tag registry is populated only by shared cells (server-side), so this runs in
// a mutation. One call drops every shared slot carrying the "docs" tag (both cacheTagA and cacheTagB)
// back to idle, so the next read of each re-runs its handler.
export default POST(() => {
  invalidate({ tags: ["docs"] })
  return { ok: true, verb: "invalidate", tags: ["docs"] }
})
