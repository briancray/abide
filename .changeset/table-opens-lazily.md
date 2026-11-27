---
"@abide/abide": patch
---

`table` opens its database at its first call, write or stream rather than where it is declared, so a module declaring one before the app is configured opens the database the config names — 47.39
