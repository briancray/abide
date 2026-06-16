/*
A pending {#await} read's deferred entry. `resolve` settles the placeholder
promise the cache handed out (with the streamed Response or a live re-fetch);
`request` is what to re-fetch on a miss or a cut stream.
*/
export type StreamingDeferred = {
    resolve: (response: Promise<Response>) => void
    request: Request
}
