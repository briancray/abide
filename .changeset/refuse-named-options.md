---
"@abide/abide": minor
---

Breaking: `refuse.named` takes its name and one options object — `refuse.named('DealClosed', { status: 409, message, schema })` — where it took the status, the message and the schema as arguments after the name. The status is optional and still defaults to 400. `abide upgrade` moves each call (38.222).
