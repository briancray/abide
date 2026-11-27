---
"@abide/harness": patch
---

the DOM preload drops the newline after a `<textarea>`, `<pre>` or `<listing>` start tag as the HTML parser does, so a textarea abide wrote empty reads `''` — 43.49
