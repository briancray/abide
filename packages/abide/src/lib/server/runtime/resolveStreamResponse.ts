import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { streamCacheResolutions } from './streamCacheResolutions.ts'
import { streamFromIterator } from './streamFromIterator.ts'
import { takePendingStream } from './streamStash.ts'

/*
The out-of-band resolution stream. The browser opens this once per streamed page
(token from `__SSR__.streamToken`) and reads newline-delimited StreamedResolution
objects as each pending {#await} fetch lands — draining the SAME in-flight
promises stashed during SSR, so handlers run once. A missing/expired token
(404) tells the client to re-fetch its placeholders live.

Returned directly (not via dispatchRequest), so it inherits the configured
`idleTimeout` as a bounded cap rather than the long-lived-stream disable; a cut
is recovered client-side off the fetch reader's clean EOF.
*/
export function resolveStreamResponse(token: string): Response {
    const stash = takePendingStream(token)
    if (!stash) {
        return new Response('', { status: 404 })
    }
    const body = streamFromIterator(streamCacheResolutions(stash.store, stash.pending), {
        encodeFrame: (resolution) => `${JSON.stringify(resolution)}\n`,
        encodeError: () => '',
    })
    return new Response(body, {
        headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': NO_STORE },
    })
}
