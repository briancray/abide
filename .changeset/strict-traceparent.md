---
"@belte/belte": patch
---

fix(belte): parseTraceparent type-checks under `noUncheckedIndexedAccess` — belte ships raw TS, so the destructured regex groups read as possibly undefined in strict consumer tsconfigs and failed the app-side check
