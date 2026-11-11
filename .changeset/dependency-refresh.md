---
"@abide/abide": patch
"@abide/harness": patch
---

`abide scaffold` writes `tailwindcss` `^4.3.5`, and the harness's DOM preload registers happy-dom 21 — which fetches no stylesheet a parsed document names by default, so the preload no longer sets the deprecated `disableCSSFileLoading`.
