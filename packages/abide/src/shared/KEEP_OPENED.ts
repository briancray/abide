/**
 * The value of the offline worker's `abide-keep` header on the page a navigation opens, which then
 * hydrates and so is seeded as one (41.29, 45.23) — a page saved behind the one opened is not.
 *
 * A leaf, because the server writes it into the worker's script and reads it off the request.
 */
export const KEEP_OPENED = 'open'
