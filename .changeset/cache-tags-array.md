---
"@abide/abide": minor
---

BREAKING: `CacheOptions.tags` (and the `cache.invalidate` / `pending` `{ tags }` selector) now accepts only a `string[]`, not `string | string[]`. Wrap a single tag in an array:

```ts
cache(getOrder, { tags: ['orders'] })({ id })
cache.invalidate({ tags: ['orders'] })
```

A bare-string tag previously auto-wrapped; the array-only form removes the `typeof` branch and the silent-splat foot-gun (a JS caller passing a multi-char string got it iterated into per-character tags).
