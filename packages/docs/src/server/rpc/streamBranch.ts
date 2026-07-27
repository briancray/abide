import { GET } from 'abide/server/GET'

// A second slow SERVER read, identical in shape to `streamSlow` but with its own memo slot, used by the
// streaming block that sits inside an `{#if}` branch on `/pages/ssr`.
//
// It needs its own slot precisely because sharing one would defeat the test: two blocks awaiting the
// same coalesced promise cannot show that the BRANCH arm kept its own render frame.
let runs = 0

export default GET(async () => {
    await Bun.sleep(120)
    runs += 1
    return { runs }
})
