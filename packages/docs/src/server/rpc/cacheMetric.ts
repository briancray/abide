import { GET } from "abide/server/GET"

// A read keyed by the WHOLE args object `{ team, id }`. Each distinct pair is its own cache slot, so
// a partial selector like `invalidate({ team: "red" })` matches every superset slot (both red rows)
// and leaves blue alone. `runs` is a global monotonic counter so a re-fetch is always visible.
let runs = 0

export default GET(({ team, id }: { team: string; id: number }) => {
  runs++
  return { team, id, runs }
})
