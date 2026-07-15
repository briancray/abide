---
"@abide/abide": patch
---

A bare rpc read (`fn(args)`) no longer derives its cache key twice. The callable already computes `keyForRemoteCall(method, url, args)` to tag its rpc-error registry entries, then `readThrough` re-derived the identical string (`callable.raw` carries the same method/url) on every read — a query-string encode for GET/DELETE or a canonical-JSON stringify for body methods, warm cache hits included. The callable now threads its key into `cache.read` and `readThrough` reuses it; the public `cache()` and raw paths still derive their own. Behavior is unchanged — the two keys were provably identical — this just removes the duplicate work from the framework's primary read path.
