---
"@abide/abide": patch
---

A `ReportDraft` and a mutation queued in `outbox` are minted their ids on a page served over plain http, where `crypto.randomUUID` is missing (RULEBOOK 48.12, 46.10).
