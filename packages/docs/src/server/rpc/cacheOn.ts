import { GET } from 'abide/server/GET'

// The contrast: a DEFAULT read is celled — the handler runs once and later reads reuse the retained
// value (the client never even re-fetches). The counter holds across reads.
let runs = 0
export default GET(() => ++runs)
