---
'@abide/abide': minor
---

BREAKING: the shipped stores and abide's own refusals are namespace members. `webStore`,
`indexedDBStore` and `cookiesStore` are `store.web`, `store.indexedDB` and `store.cookies` —
`reactive('', { store: store.web('draft') })` — and `@abide/abide/server`'s `store` adds
`store.sqlite` and `store.redis` (were `sqliteStore` and `redisStore`). `notFound`,
`validationError` and `aborted` are `refuse.notFound`, `refuse.validation` and `refuse.aborted`,
beside `refuse.named`. The old names are gone: rename each import to `store` or `refuse` and the
call to its member (RULEBOOK 8.22-8.40, 15.7-15.9). A page reading `store.web` still loads that
store alone, not its siblings (38.94). The `Store` type is unchanged.
