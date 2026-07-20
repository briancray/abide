import { POST } from "abide/server/POST"
import { refresh } from "abide/shared/refresh"

// Drives the GLOBAL tag verb `refresh({ tags })` — the eager sibling of `invalidate({ tags })`.
// Server-only (the tag registry lives server-side). One call eagerly revalidates every shared slot
// carrying the "docs" tag (both cacheTagA and cacheTagB), retaining each stale value while it
// re-runs — so a later read of each returns a freshly climbed `runs`.
export default POST(() => {
  refresh({ tags: ["docs"] })
  return { ok: true, verb: "refresh", tags: ["docs"] }
})
