import { GET, json } from 'abide/server'

/**
 * The ordinary answer. `json` sets the content type and serialises — one call rather than a
 * `new Response(JSON.stringify(…), { headers: … })` written the same way in every handler.
 *
 * A handler that returns a plain value never needs this: the transport encodes it. This is for a
 * route that builds its own `Response` — a status to set, a header to add, a body already a string.
 */
export const catalogue = GET(() => json({ items: ['alpha', 'beta'] }, { status: 200 }))
