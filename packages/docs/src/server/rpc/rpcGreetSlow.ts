import { error } from 'abide/server/error'
import { GET } from 'abide/server/GET'

// The `{#await}` demo's read — deliberately SLOW, and failing on demand.
//
// It has its own file because the block it demonstrates has three branches and a fast read can only
// ever show one of them. `rpcGreet` settles in-proc in microseconds, well inside the 4ms SSR streaming
// deadline, so a `{#await}` over it renders `{:then}` INLINE: the pending branch never paints and the
// catch branch is unreachable. Making `rpcGreet` itself slow was not an option — eight other demos
// read it and would all have paid for this one.
//
// 400ms clears the deadline with a wide margin, so the pending branch really does render into the
// shell and the value arrives as an out-of-order patch; `fail: true` is a different memo slot, which
// is what lets the demo drive the third branch without a second RPC.
export default GET(async ({ name = 'world', fail = false }) => {
    await Bun.sleep(400)
    if (fail) return error(503, 'the greeting service is unreachable')
    return { greeting: `Hello, ${name}!`, length: name.length }
})
