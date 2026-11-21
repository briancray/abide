---
"@abide/abide": minor
---

`copyText` is now `copy`. It takes a record of MIME type to what that type holds, beside a string, so one click copies `text/html` and `text/plain` together, or an `image/png` Blob, as one clipboard item (RULEBOOK 53.57). Where `navigator.clipboard` or `ClipboardItem` is missing or refuses, the selected-textarea fallback lays every string type on the `copy` event, and a value holding no string reports not copied (53.22, 53.58). Rename `copyText(…)` to `copy(…)`; a string copies as before.
