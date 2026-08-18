import { GET } from 'abide/server'
import { lastShipped } from '#server/lib/otlp.ts'

/**
 * What this app's exporting rung shaped for the request BEFORE this one.
 *
 * Not for this one: the rung is outermost, so it finishes its span on the way back out — after the
 * handler that would answer with it has already returned. A reader pressing twice sees the first press
 * on the second, which is the ordering rather than a delay.
 */
export const whatWasShipped = GET(() => ({ span: lastShipped() }))
