---
"@abide/abide": minor
---

`abide check` now type-checks the project's `.ts` files too, not only `.abide` templates. The `.ts` files were already loaded into the shadow program to resolve component imports, but their own diagnostics were never reported — so a mistyped `navigate('/p/[id]', {})`, `url()`, or `fn.patch()` call (or any type error) in an rpc handler, `app.ts`, or a `$shared` helper passed `abide check` silently. It now surfaces there, making `abide check` a complete type-check (templates + `.ts`) rather than templates only. Scoped to the project's own root files — a dependency or monorepo sibling resolved on demand is not reported. No new public API.
