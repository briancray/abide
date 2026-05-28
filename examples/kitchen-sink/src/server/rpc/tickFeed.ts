import { GET } from 'belte/server/GET'
import { sse } from 'belte/server/sse'

/*
SSE streaming over plain HTTP. The handler returns `sse(asyncIterable)` —
each yielded frame becomes one `data: <json>\n\n` event. The client
consumes with `new EventSource(tickFeed.url)`, or by reading
`tickFeed.raw(...)`'s body if it needs Response headers/status. For
pub/sub fan-out reach for `belte/server` instead.
*/
export const tickFeed = GET(() =>
    sse(
        (async function* () {
            for (let tick = 1; ; tick += 1) {
                yield { tick, at: new Date().toISOString() }
                await Bun.sleep(1000)
            }
        })(),
    ),
)
