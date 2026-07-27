import { GET } from 'abide/server/GET'
import { transcript } from '$server/chatterLoop'

// Read what the server-side loop has collected. `memo: false` so every read reflects the live loop
// rather than a retained slot — this is pub/sub state, not a memoized fetch.
// #demo chatterSeen
export default GET(() => transcript(), { memo: false })
// #enddemo
