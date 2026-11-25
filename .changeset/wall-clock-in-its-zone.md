---
"@abide/abide": patch
---

format.date, format.dateParts, format.relative and time read a date-time with no offset — `2026-11-18T15:04`, what format.date's 'input' style writes and a datetime-local field holds — as that wall clock in the zone they write in, rather than in the process's zone, so it no longer moves between the server and the browser; one with a `Z` or an offset is still the instant it names — 52.113
