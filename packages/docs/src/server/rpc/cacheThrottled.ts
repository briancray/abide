import { GET } from 'abide/server/GET'

// The SWR refetch clock, throttle edge. `runs` counts real executions, so a burst of `refresh()`
// calls inside the window is observable as WORK rather than as a value: throttle fires on the
// LEADING edge and then collapses the rest of the window into ONE trailing load, so five rapid
// triggers cost two runs, not five.
//
// The clock is bilateral — the registry ships it to the browser proxy, so this is the CLIENT memo's
// clock the demo is driving, not the server's.
let runs = 0

export default GET(
    ({ tag = 'th' }) => {
        runs++
        return { tag, runs }
    },
    { memo: { throttle: 400 } },
)
