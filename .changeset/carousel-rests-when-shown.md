---
"@abide/abide": patch
---

A `carousel` bound with no box — inside a closed `dialog`, a hidden panel — scrolls to the item it rests on the moment it gets one, and again each time it is shown (53.62, 53.63). A `lightbox` opened on an item had stayed on the first, with `next` disabled, and reopening on the same item left it wherever it was closed. Its scrolls now go to an offset rather than by one, so in WebKit a second click of `previous` or `next` while the first is still scrolling lands centered rather than ~26px short.
