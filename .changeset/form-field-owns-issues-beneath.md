---
'@abide/abide': minor
---

A `form` field whose own name has no issue takes the first issue beneath it as its `message`, so a structured member posted as one field — `positions` as JSON (19.27) — shows the issue at `positions.0.shares`, and is `aria-invalid` and focused as any field with a message is (56.36).
