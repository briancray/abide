import { GET } from 'abide/server/GET'

// A deliberately slow SERVER read so a `{#await}` block MISSES the SSR streaming deadline (4ms) and
// streams as an out-of-order patch (streaming-ssr-plan PR2/PR3) instead of rendering inline. The run
// counter increments on every (re-)fetch, so the e2e can prove the CLAIMED await block stays reactive
// after hydration — a refresh re-fetches and re-renders the streamed subtree in place.
let runs = 0

export default GET(async () => {
    await Bun.sleep(120)
    runs += 1
    return { runs }
})
