/*
Wire descriptor for a {#await} cache read that's still pending at first flush.
Shipped in `__SSR__.streaming` so the client can pre-create a deferred cache
entry for the key before hydration — `cache()` then hits that placeholder
instead of firing its own fetch, and the streamed `__abideResolve` settles it.
`url`/`method` reconstruct the entry's Request for the rare miss fallback (a
non-snapshottable body the client re-fetches live).
*/
export type StreamingPlaceholder = {
    key: string
    url: string
    method: string
}
