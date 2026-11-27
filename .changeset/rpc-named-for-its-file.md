---
"@abide/abide": patch
---

An `rpc` a server file exports by the file's own name answers at the file's path, as its default does — `export const getDeal = rpc(…)` in `deals/getDeal.server.ts` answers `/deals/getDeal` — and a file exporting both is refused at build (16.2). `abide upgrade` exports a moved handler file's default by its file's name, and imports it by that name (38.231). The docs, the CRM and the scaffold name every `rpc`.
