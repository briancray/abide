---
"@belte/belte": patch
---

remaining `noUncheckedIndexedAccess` errors in shipped source (parsePromptMarkdown, logExposedSurfaces, createPageRenderer, createMcpResourceServer) — and CI now type-checks the shipped surface under the scaffolded consumer tsconfig plus that flag, so this class of strict-consumer breakage fails CI instead of an app's `bun check`
