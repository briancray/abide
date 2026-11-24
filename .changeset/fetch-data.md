---
"@abide/abide": minor
---

`fetchData` replaces `fetchJson` and `fetchText`: one fetch with the same deadline, retries, cache and `schema`, reading the body as its `content-type` says, as `handle` reads one — JSON as its value, text as a string, anything else as a `Blob` — or as `as: 'json' | 'text' | 'blob'` names whatever the type says. `fetchJson(url)` becomes `fetchData(url)` (or `fetchData(url, { as: 'json' })` for a service that labels JSON as something else), and `fetchText(url)` becomes `fetchData(url, { as: 'text' })`. A JSON body that does not parse now carries the status it was answered at rather than `null` (RULEBOOK 54.12-54.14, 54.17)
