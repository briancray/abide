import { GET } from 'belte/rpc'
import { jsonl } from 'belte/response'

/*
JSONL streaming over plain HTTP — one JSON object per line. Best when
the consumer is itself another script (logs, large result sets, bulk
exports) rather than a browser's EventSource. `subscribe(fn)(args)`
parses it for you on the client just like SSE.
*/
export const countLog = GET<{ to: number }, { n: number }>(({ to }) =>
    jsonl(
        (async function* () {
            for (let n = 1; n <= to; n += 1) {
                yield { n }
                await Bun.sleep(200)
            }
        })(),
    ),
)
