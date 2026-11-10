---
"@abide/abide": patch
---

A server-rendered `<select>` reads a numeric reference in 0x80–0x9F through the windows-1252 remap, as the browser does: `&#128;` is `€`, so `bind:value` marks the option the browser's `option.value` says it holds.
