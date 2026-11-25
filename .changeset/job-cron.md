---
"@abide/abide": minor
---

a `job` can run on the times a cron expression names: `job({ cron: '0 8 * * 1-5', timeZone: 'America/New_York', run })`, given in place of `every` — one or the other, a `TypeError` otherwise — read by `Bun.cron.parse`, waiting for its first time rather than running as the app opens, and running once for every time a restart missed (54.36, 54.37, 54.38)
