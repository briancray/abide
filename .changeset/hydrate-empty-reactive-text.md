---
"@abide/abide": patch
---

fix hydration null-deref when a reactive text binding first renders an empty string — the server emits no text node, so the client now synthesizes its own node at the claim cursor instead of dereferencing null in the bind effect
