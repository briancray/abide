import { jsonl } from 'abide/server/jsonl'
import { POST } from 'abide/server/POST'

// A STREAMING mutation. A POST handler that yields an `AsyncIterable` is stored as a ReplayableStream
// exactly like a streaming read and re-encoded as `application/jsonl`. The browser proxy decodes it back
// into an `AsyncIterable`, so `{#for await step of rpcStreamJob(...)}` works identically to a streaming
// read — full read/mutation symmetry for streams. Args ride in the JSON body (which also passes CSRF).
export default POST(({ steps = 3 }) => {
    async function* run(): AsyncIterable<{ step: number; label: string }> {
        for (let step = 1; step <= steps; step++) {
            await new Promise((resolve) => setTimeout(resolve, 25))
            yield { step, label: `step ${step} of ${steps} done` }
        }
    }
    return jsonl(run())
})
