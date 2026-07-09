import { GET } from '@abide/abide/server/GET'
import { jsonl } from '@abide/abide/server/jsonl'

/* Wrapper indirection: the handler returns makeStream(), which returns jsonl(...).
   The char-scan `detectStreaming` sees no literal `jsonl(`/`sse(` in the handler body,
   so it misclassifies this non-streaming; the return-type query sees the stream. */
function makeStream() {
    return jsonl(
        (async function* () {
            yield { n: 1 }
        })(),
    )
}

export const wrapFeed = GET(() => makeStream())
