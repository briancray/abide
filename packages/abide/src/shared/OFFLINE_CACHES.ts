// 45.3, 45.5 — THE CACHES THE SERVICE WORKER KEEPS, named once for the worker the server writes and
// the router that asks whether a page was saved (45.12). A leaf, for the reason every constant
// crossing a seam is one.

/** What every cache the worker keeps is named under, so a cache an earlier worker named is found. */
export const OFFLINE_CACHE_PREFIX = 'abide:'

/** The pages and the handlers' answers the worker saved, by address. */
export const OFFLINE_SAVED = `${OFFLINE_CACHE_PREFIX}saved`

/** What the worker saved that any caller may be answered — `cache-control: public` — by address. */
export const OFFLINE_SHARED = `${OFFLINE_CACHE_PREFIX}shared`

/** The build's bundle, saved as the worker installs. */
export const OFFLINE_BUNDLE = `${OFFLINE_CACHE_PREFIX}bundle`
