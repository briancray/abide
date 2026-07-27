import { GET } from 'abide/server/GET'
import { doubled, total, watchFires } from '$shared/serverReactive'

// Reads the current server-side graph: the source `state`, its derived `memo`, and the `watch`
// fire-count. `memo: false` so every read reflects the live values (this is reactive state, not a
// memoized fetch).
export default GET(() => ({ total: total.untracked(), doubled: doubled.peek(), fires: watchFires() }), {
    memo: false,
})
