---
"@abide/abide": patch
---

feat(ui): a bare attribute on a child component now coerces to `true` instead of the empty string. `<Toggle on />` passes `on: true`, matching HTML's presence-means-true semantics and a `boolean` prop's declared type (previously it passed `""`, which the type-checking shadow flagged against `on: boolean` — leaving no way to write a bare boolean that both read naturally and type-checked). An explicit `<Toggle on="" />` still passes the empty string, and native DOM elements are unchanged (`<button disabled>` still serialises to `disabled=""`). Behavior change: a component reading a bare prop and expecting `""` now receives `true`.
