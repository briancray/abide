import { POST } from 'abide/server/POST'

// A CACHED mutation. `memo: { ttl }` opts this POST into retention, so it gains the full read surface
// on the client: a repeat call within the ttl HITS the cache (handler not re-run), `.live(args)` returns
// the retained value, and `.refresh(args)` re-runs the handler (`.refreshing(args)` is true meanwhile).
// The module `runs` counter makes each real execution observable — a cache hit keeps the number, a
// refresh bumps it. Default mutations are `ttl: 0` (retain nothing); this one opts in.
let runs = 0
export default POST(
    ({ id = 'counter' }) => {
        runs++
        return { id, runs }
    },
    { memo: { ttl: 60_000 } },
)
