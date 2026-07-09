import { GET } from '@abide/abide/server/GET'
import { jsonl } from '@abide/abide/server/jsonl'

/* Direct jsonl() in the handler body — streaming by both the scan and the type query. */
export const directFeed = GET(() =>
    jsonl(
        (async function* () {
            yield { n: 1 }
        })(),
    ),
)
