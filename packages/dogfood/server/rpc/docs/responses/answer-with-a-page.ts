import { GET, page } from 'abide/server'

/**
 * The same shape, HTML instead. `page` sets the content type and, when the body is a stream, takes
 * the hold that keeps it alive past the handler that returned it — the one thing a hand-written
 * `new Response(stream)` gets wrong, because the handler returns before the body has finished.
 */
export const catalogue = GET(() => page('<h1>alpha</h1><p>beta</p>', { status: 200 }))
