---
'@abide/abide': patch
---

A `bind:` writes its value before an `on<event>` on the same element runs — `<input type="file" bind:files={picked} onchange={use}>` hands `use` the files just picked, and an `oninput` beside `bind:value` reads the text just typed, wherever the two are written in the tag (RULEBOOK 32.75).
