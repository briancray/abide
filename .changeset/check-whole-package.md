---
"@abide/abide": minor
---

`abide check` reports on every file the app's `tsconfig.json` includes inside the app's package — its tests, scripts and browser specs as well as `src` — and on nothing inside a package nested in it (RULEBOOK 38.209, 38.210). `bun check` runs an app's `check` script in place of `tsc`, so those files were checked by nothing
