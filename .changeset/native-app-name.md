---
"@abide/abide": minor
---

`abide native` names the app by its `APP_NAME` where an `onConfig` default or the environment it runs in sets one — the bundle's name and display name, the `.app`, the menu bar, the window and `Launch.name` — and keeps the `package.json` name for the executable and the bundle identifier, so the app's remembered state and settings stay where they were (RULEBOOK 38.78, 38.87). The name is read when `abide native` runs, before any `onConfig` schema, which may require what only the start form supplies
