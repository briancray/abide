---
"@belte/belte": minor
"@belte/claude-code": minor
---

Bundle apps auto-start the local assistant. When a bundled belte app connects (embedded or remote) and the app ships `@belte/claude-code` (its UI uses `browser/assistant`) with `claude` on PATH, the bundle launcher runs the loopback bridge for you and hands the page its port+token via the URL fragment — no copy-paste command. The bridge is loopback-only and dies with the connection. belte takes **no dependency** on `@belte/claude-code`: it's a guarded optional import that no-ops (and compiles fine) when the app doesn't ship it.

`assistant()` gains a `status` — `'ready' | 'starting' | 'manual' | 'unavailable'` — so the same UI works in a browser (`manual` → show `command`) and a bundle (`starting`/`ready` auto-managed, or `unavailable` when `claude` isn't installed → show an install hint). `command` is now `string | undefined` (undefined whenever a host manages the bridge).
