import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'

// Keepalive comment cadence — keeps the idle SSE connection from being dropped.
const KEEPALIVE_INTERVAL_MS = 15000

/*
The dev live-reload channel (`/__belte/dev`, dev only). An SSE stream that
carries no events of its own — the browser-side client (DEV_RELOAD_CLIENT_SCRIPT)
reloads when this connection drops and reconnects, which only happens when the
dev orchestrator restarts the server after a rebuild. The opening `retry: 250`
shortens EventSource's reconnect backoff; a periodic comment keeps the idle
connection alive. The interval is cleared when the consumer disconnects.
*/
export function devReloadResponse(): Response {
    let keepalive: ReturnType<typeof setInterval>
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('retry: 250\n\n'))
            keepalive = setInterval(() => {
                controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
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
