import { GET } from "abide/server/GET"

// A deliberately slow read so the `pending` probe (and a "refresh keeps the stale value visible"
// window) are observable in a real browser. Per-key run counter proves each re-fetch actually ran.
const runsByKey = new Map<string, number>()

export default GET(async ({ key = "alpha" }: { key?: string }) => {
  await Bun.sleep(500)
  const next = (runsByKey.get(key) ?? 0) + 1
  runsByKey.set(key, next)
  return { key, runs: next }
})
