import { GET } from 'belte/rpc'
import { sse } from 'belte/response'

/*
SSE streaming over plain HTTP. The handler returns `sse(asyncIterable)` —
each yielded frame becomes one `data: <json>\n\n` event. Consumers on
the client can use `EventSource`, the framework's `subscribe(fn)(args)`,
or just `.stream(args)` for a `for await` loop.
*/
export const tickFeed = GET<undefined, { tick: number; at: string }>(() =>
    sse(
        (async function* () {
            for (let tick = 1; ; tick += 1) {
                yield { tick, at: new Date().toISOString() }
                await Bun.sleep(1000)
            }
        })(),
    ),
)
