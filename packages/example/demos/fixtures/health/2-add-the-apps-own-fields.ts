import { onHealth } from 'abide/server'

/**
 * Merged OVER the baseline, so the app wins every field it names.
 *
 * A reporter that throws becomes an account of not working — `error` in the document and a 503 off that
 * one field — rather than a route falling over, which is exactly the case a health check exists for.
 */
onHealth(() => ({
    example: { serving: true, queued: 0 },
}))
