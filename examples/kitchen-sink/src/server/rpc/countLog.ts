import { GET } from '@abide/abide/server/GET'
import { jsonl } from '@abide/abide/server/jsonl'
import { z } from 'zod'

// GET args arrive as query-string text ("8"), so coerce to a number —
// also accepts the CLI's `--to=5` string flag and MCP's numeric JSON.
const inputSchema = z.object({ to: z.coerce.number() })

/*
JSONL streaming over plain HTTP — one JSON object per line. Best when
the consumer is itself another script (logs, large result sets, bulk
exports) rather than a browser's EventSource. Clients read the
Response body via `.raw(args)` and parse with TextDecoderStream + a
split-by-newline reduce.

The `inputSchema` makes this read-only stream reachable beyond the
browser: as the CLI command `countLog --to=5` (frames print as NDJSON)
and as an MCP tool `countLog` (frames drain into `structuredContent`).
*/
export const countLog = GET(
    ({ to }) =>
        jsonl(
            (async function* () {
                for (let n = 1; n <= to; n += 1) {
                    yield { n }
                    await Bun.sleep(200)
                }
            })(),
        ),
    { inputSchema },
)
