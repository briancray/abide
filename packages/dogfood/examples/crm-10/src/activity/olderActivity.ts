import { GET } from '@abide/abide/server'

const OLDER = [
    { on: '2026-09-02', note: 'Intro call, asked for pricing' },
    { on: '2026-09-09', note: 'Sent the proposal' },
    { on: '2026-10-01', note: 'Signed for 40 seats' },
]

/** Answers at /activity/olderActivity, one entry at a time as each is read. */
export default GET(
    async function* () {
        for (const entry of OLDER) {
            // A slow archive: each entry lands on its own.
            await Bun.sleep(600)
            yield entry
        }
    },
    { description: "Hopper & Co's older activity, as it is read." },
)
