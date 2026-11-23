---
"@abide/abide": patch
---

`sortRows`, and so `SortableTable`, compares text in the `en-US` locale `format` writes in, rather than the runtime's, so rows a server sorted keep their order once the page hydrates (RULEBOOK 51.46).
