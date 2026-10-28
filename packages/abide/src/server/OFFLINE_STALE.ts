// 21.22, 21.23 — HOW LONG A COPY KEPT ON THE DEVICE STAYS SERVABLE once stale, where `ABIDE_OFFLINE`
// registers its worker: a week while the network answers and the copy is asked for again behind it,
// and a year where the network fails — a copy of any age beats the page saying nothing was saved, and
// what may evict it sooner (Safari's week for a site not visited) is the browser's, not this header's.
//
// NO `max-age` BESIDE IT on a page or a `GET`: a copy reads `max-age` as its own life (18.14), and
// a followed copy stale from the moment it landed would reload on every read. With no lifetime and
// no `Last-Modified`, a cache holds the answer stale at once, which is all the two windows need.

export const OFFLINE_STALE =
    'stale-while-revalidate=604800, stale-if-error=31536000'
