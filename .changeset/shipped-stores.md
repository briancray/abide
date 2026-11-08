---
"@abide/abide": minor
---

`webStore` (from `@abide/abide`) and `sqliteStore` (from `@abide/abide/server`) — shipped `Store`s for Web Storage, following other tabs' writes and inert on a server, and for a `bun:sqlite` table; both keep the value's `ttl` beside it and run an optional `schema` over what they read (RULEBOOK 8.22 through 8.28)
