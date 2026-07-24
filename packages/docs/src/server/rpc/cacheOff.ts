import { GET } from 'abide/server/GET'

// `cache: false` opts this read OUT of the memo entirely — every call runs the handler (no retain, no
// coalesced reuse, no client cache). The run counter climbs on EVERY read, on both sides.
let runs = 0
export default GET(() => ++runs, { cache: false })
