import { GET } from 'abide/server/GET'

// The SWR refetch clock, debounce edge — the sibling of `cacheThrottled`. Debounce fires only AFTER
// quiet, and every trigger restarts the window, so the same five rapid `refresh()` calls cost ONE
// run where throttle costs two. Setting both edges on one memo is a construction-time error: they
// are two edges of one clock, not two clocks.
let runs = 0

export default GET(
    ({ tag = 'db' }) => {
        runs++
        return { tag, runs }
    },
    { memo: { debounce: 400 } },
)
