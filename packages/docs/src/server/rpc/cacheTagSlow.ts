import { GET } from 'abide/server/GET'

// A slow, SHARED, TAGGED read — the subject of the global tag-probe demo. Being shared registers its
// slot in the server-only tag registry under "live", so the global `pending({ tags: ["live"] })` /
// `refreshing({ tags: ["live"] })` aggregates can observe it.
let runs = 0
export default GET(
    async () => {
        runs++
        await new Promise((resolve) => setTimeout(resolve, 200))
        return runs
    },
    { memo: { crossRequest: true, tags: ['live'] } },
)
