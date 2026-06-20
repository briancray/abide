---
"@abide/abide": patch
---

fix(ui): JSON-Pointer-escape reactive-document path keys so a key containing `/` or `~` addresses one segment instead of mis-splitting. `lowerDocAccess` lowered `model.byId[key]` to a raw `/`-joined path (`"byId/" + key`), and `model["a/b"]` to a raw literal — but the read side (`walkPath`) splits on `/` and `unescapeKey`s each segment. So a composite key (a date, a URL id, a slash-bearing string) round-tripped wrong: `model.byId["a/b"]` read/removed `byId → a → b` instead of the `"a/b"` entry. The `escapeKey` helper was written for exactly this (its doc cites "a URL id, a date, a composite key") and AGENTS.md documents scope keys as escaped — but it was never called.

The lowering now escapes both halves: literal keys at compile time (`model["a/b"]` → `read("byId/a~1b")`), dynamic segments at runtime (`model.byId[key]` → `read("byId/" + escapeKey(key))`). `escapeKey` joins `UI_RUNTIME_IMPORTS` (DCE-filtered, so only emitted when a component uses a dynamic/special key) and is exported at `abide/ui/runtime/escapeKey`; it now coerces (`String(key)`) since a dynamic segment is often a numeric array index. Plain identifier/index paths are unaffected.
