import { POST } from 'abide/server'

/**
 * The three limits, and each is CLOSED until the declaration opens it — which is the only default that
 * is safe to have.
 *
 * `timeout` is ms without PROGRESS rather than a total, so a handler that yields is judged per chunk
 * and a slow stream is not a failed one.
 *
 * `crossOrigin` is who else may call. Closed unless declared, `'*'` opens it, and the websocket
 * upgrade is gated by the same list — one answer for both transports, so an endpoint cannot be shut to
 * a fetch and open to a socket.
 *
 * `maxBodySize` is the largest body a mutation will accept, in bytes.
 */
export const upload = POST(async ({ note }: { note: string }) => ({ stored: note.length }), {
    timeout: 5_000,
    crossOrigin: ['https://studio.example.com'],
    maxBodySize: 64 * 1024,
})
