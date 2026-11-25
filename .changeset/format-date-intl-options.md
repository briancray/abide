---
"@abide/abide": minor
---

format.date and format.dateParts take Intl.DateTimeFormat's own options beside style — `{ style: 'dateTime', weekday: 'short' }` — and format.number writes a value in the unit it is handed — 52.112, 52.114, 52.115
