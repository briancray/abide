import { jsonl } from 'belte/respond'
import { GET } from 'belte/route'

/*
JSONL streaming over plain HTTP — one JSON object per line. Best when
the consumer is itself another script (logs, large result sets, bulk
exports) rather than a browser's EventSource. Clients read the
Response body via `.raw(args)` and parse with TextDecoderStream + a
split-by-newline reduce.
*/
export const countLog = GET<{ to: number }>(({ to }) =>
    jsonl(
        (async function* () {
            for (let n = 1; n <= to; n += 1) {
                yield { n }
                await Bun.sleep(200)
            }
        })(),
    ),
)
