import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'

// Keepalive comment cadence — keeps the idle SSE connection from being dropped.
const KEEPALIVE_INTERVAL_MS = 15000
const TEXT_ENCODER = new TextEncoder()

/*
The dev live-reload channel (`/__belte/dev`, dev only). An SSE stream carrying
one event: the worker's client fingerprint (devClientFingerprint). The
connection drops when the dev orchestrator swaps the server after a rebuild;
the browser-side client (DEV_RELOAD_CLIENT_SCRIPT) reconnects and reloads only
if the new worker announces a different fingerprint — a server-only edit keeps
the page alive. The opening `retry: 250` shortens EventSource's reconnect
backoff; a periodic comment keeps the idle connection alive. The interval is
cleared when the consumer disconnects.
*/
export function devReloadResponse(fingerprint: string): Response {
    let keepalive: ReturnType<typeof setInterval>
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(TEXT_ENCODER.encode(`retry: 250\ndata: ${fingerprint}\n\n`))
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
