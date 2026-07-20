import { GET } from 'abide/server/GET'
import { jsonl } from 'abide/server/jsonl'

// A streaming read: `jsonl(ticks())` sees through to the generator, so the cell stores a ReplayableStream
// (concurrent/late viewers share ONE run; retained per `cache.ttl`). The router re-encodes it as
// `application/jsonl`, which the browser consumes and renders line-by-line with `{#for await}`.
export default GET(({ count = 4 }: { count?: number }) => {
    async function* ticks(): AsyncIterable<{ n: number; label: string }> {
        for (let n = 1; n <= count; n++) {
            await new Promise((resolve) => setTimeout(resolve, 25))
            yield { n, label: `tick ${n} of ${count}` }
        }
    }
    return jsonl(ticks())
})
