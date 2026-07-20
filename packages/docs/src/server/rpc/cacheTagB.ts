import { GET } from "abide/server/GET"

// The sibling of cacheTagA: a SHARED read carrying the same "docs" tag. One global
// `invalidate({ tags: ["docs"] })` drops BOTH cells' slots at once — the whole point of tags —
// so a later read of each re-runs its handler and `runs` climbs on both together.
let runs = 0

export default GET(
  async ({ tag = "b" }: { tag?: string }) => {
    await Bun.sleep(150)
    runs++
    return { tag, runs }
  },
  { cache: { shared: true, tags: ["docs"] } },
)
