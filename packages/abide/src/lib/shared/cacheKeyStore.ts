/*
WeakMap recording the cache key behind a `cache()` read's returned promise, so a
consumer holding only the promise can recover its key. Mirrors remoteMetaStore (which
records the synthesized Request the same way). The SSR resume path uses it to decide
whether a `{#await cache()}` value is a large cache-backed read it can defer — shipping a
`{ defer, key }` marker instead of the value. Collected with the promise.
*/
export const cacheKeyStore = new WeakMap<Promise<unknown>, string>()
