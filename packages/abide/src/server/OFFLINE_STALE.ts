// 21.22, 21.23 — HOW LONG A COPY KEPT ON THE DEVICE STAYS SERVABLE once stale, where `ABIDE_OFFLINE`
// registers its worker: a week, while the network answers or fails to — as long as Safari keeps an
// unvisited site's storage.
//
// NO `max-age` BESIDE IT on a page or a `GET`: a copy reads `max-age` as its own life (18.14), and
// a followed copy stale from the moment it landed would reload on every read. With no lifetime and
// no `Last-Modified`, a cache holds the answer stale at once, which is all the two windows need.

export const OFFLINE_STALE =
    'stale-while-revalidate=604800, stale-if-error=604800'
