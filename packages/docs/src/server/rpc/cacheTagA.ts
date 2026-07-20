import { GET } from "abide/server/GET"

// A SHARED read tagged "docs". Declaring `tags` on a shared read registers this cell in the
// server-side tag registry, so the global `invalidate({ tags: ["docs"] })` / `refresh({ tags })`
// selectors act on it (and its sibling cacheTagB) together. `runs` counts real handler executions;
// the small delay makes the first-load `pending({ tags })` aggregate observable server-side.
let runs = 0

export default GET(
  async ({ tag = "a" }: { tag?: string }) => {
    await Bun.sleep(150)
    runs++
    return { tag, runs }
  },
  { cache: { shared: true, tags: ["docs"] } },
)
