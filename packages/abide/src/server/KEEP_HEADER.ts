/**
 * The header the offline worker asks for a page it keeps under, so the page carries the early calls
 * a later open of it starts (41.30, 45.23).
 *
 * A leaf, because the server writes it into the worker's script and reads it off the request.
 */
export const KEEP_HEADER = 'abide-keep'
