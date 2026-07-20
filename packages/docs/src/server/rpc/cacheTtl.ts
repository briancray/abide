import { GET } from "abide/server/GET"

// A SHARED read with a TTL: the process-global slot is served from cache until it is `ttl` ms old,
// then the next read re-runs the handler. `runs` counts real executions, so two `raw()` fetches
// inside the window return the SAME count, and a fetch after the window returns a HIGHER one —
// proof the value expired and re-fetched. TTL is enforced server-side (the client cell is untimed).
let runs = 0

export default GET(
  ({ tag = "t" }: { tag?: string }) => {
    runs++
    return { tag, runs }
  },
  { cache: { shared: true, ttl: 700 } },
)
