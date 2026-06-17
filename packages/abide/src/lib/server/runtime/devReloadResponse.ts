import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import type { DevReloadStamp } from './types/DevReloadStamp.ts'

// Keepalive comment cadence — keeps the idle SSE connection from being dropped.
const KEEPALIVE_INTERVAL_MS = 15000
const TEXT_ENCODER = new TextEncoder()

/*
The dev live-reload channel (`/__abide/dev`, dev only). An SSE stream carrying
one event: the worker's reload stamp (devClientFingerprint) as JSON. The
connection drops when the dev orchestrator swaps the server after a rebuild;
the browser-side client (DEV_RELOAD_CLIENT_SCRIPT) reconnects and compares — a
changed `structure` reloads, a changed `cssHref` alone swaps the stylesheet in
place, and a server-only edit (both equal) keeps the page alive. The opening
`retry: 250` shortens EventSource's reconnect backoff; a periodic comment keeps
the idle connection alive. The interval is cleared when the consumer disconnects.
*/
export function devReloadResponse(stamp: DevReloadStamp): Response {
    let keepalive: ReturnType<typeof setInterval>
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(
                TEXT_ENCODER.encode(`retry: 250\ndata: ${JSON.stringify(stamp)}\n\n`),
            )
            keepalive = setInterval(() => {
                controller.enqueue(TEXT_ENCODER.encode(': keepalive\n\n'))
            }, KEEPALIVE_INTERVAL_MS)
        },
        cancel() {
            clearInterval(keepalive)
        },
    })
    return new Response(body, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': NO_STORE,
            'X-Content-Type-Options': 'nosniff',
            Connection: 'keep-alive',
        },
    })
}
