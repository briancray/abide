---
'@abide/abide': minor
---

Three new stores: `redisStore` (from `@abide/abide/server`, over `bun`'s `RedisClient`, expiring the
key with the `ttl` and following its keyspace channel), `indexedDBStore` (the browser's IndexedDB,
following other tabs' writes over a `BroadcastChannel`), and `cookiesStore` (a cookie through
`cookies()`, so the server renders the stored value). Every shipped store now keeps its key under the
app's name — a value `webStore` or `sqliteStore` kept under the bare key is not read back — and a
re-read of unchanged text answers the value it answered before, so a `watch` echoing a store's own
write wakes no reader.
