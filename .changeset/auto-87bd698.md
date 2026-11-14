---
"@abide/abide": patch
---

the app runs on a thread of its own — RULEBOOK 38.180, cited from abide native and onStop, a line in ABIDE.md and a paragraph on the native page: shutdown work goes in onStop, since no signal reaches a process.on handler, and process.exit ends the whole app ([`87bd698`](https://github.com/briancray/abide/commit/87bd69862edbe1318852e4cd93bbf3c36f010977))
