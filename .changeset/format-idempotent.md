---
'@abide/abide': patch
---

Fix: `abide format` is idempotent — a multi-line `/* … */` comment in a branch-local `<script>`, a component's setup, a `<style>` or a multi-line expression no longer moves further right on every run. Each piece is handed to `bun fmt` with the indentation of where it stands taken off, since `bun fmt` keeps a block comment's continuation lines as given and abide indents them again (RULEBOOK 38.137).
