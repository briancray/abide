// An app with the log feed mounted, for `test/cli.test.ts` to tail.
//
// A SPAWNED process for the same two reasons `transport-wire.ts` is one: `bunfig.toml` preloads
// happy-dom for every test file, whose `Response` and `URL` `Bun.serve` cannot serialise — and a
// command that tails a wire has nothing to say about the endpoint unless the wire is real.
//
// The port is printed first and the app then talks for as long as it is left running: one line
// BEFORE anyone is listening, which the ring replays, and one every tick after, which arrives live.
// A tail that can only prove one of those is a tail that cannot tell a replay from a subscribe.

import { log } from 'abide'
import { dispatch, websocket } from 'abide/server'

const running = Bun.serve({
    port: 0,
    fetch: async (request, self) =>
        (await dispatch(request, self)) ?? new Response('an app route', { status: 404 }),
    websocket,
})

// The first line of stdout, and the only one that is not a log record: what the test connects to.
console.log(JSON.stringify({ port: running.port }))

log('written before anyone was listening')

let ticks = 0
setInterval(() => {
    ticks += 1
    log(`tick ${ticks}`)
}, 40)
