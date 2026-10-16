import { GET, sse } from '@abide/abide/server'

const MOVES = [
    { account: 'Hopper & Co', stage: 'Won' },
    { account: 'Analytical Engines', stage: 'Proposal' },
    { account: 'Langley Research', stage: 'Qualified' },
]

/** Answers at /activity/ticker as server-sent events, whatever is asked. */
export default GET(() => sse(MOVES), {
    description: "Today's deal moves, as server-sent events.",
})
