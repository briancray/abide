---
"@abide/abide": minor
---

`format.date` with no `timeZone` writes in the visitor's zone — UTC on the server and while the page hydrates, so the two agree, then the browser's own — or in the zone the app pins with `format.timeZone.set(zone)`, per request on a server (RULEBOOK 52.3, 52.44, 52.45, 41.32)
