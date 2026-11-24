---
"@abide/abide": patch
---

A `carousel`'s `previous` or `next` that its own click disables hands focus to the other button rather than dropping it to the page (53.91). In a `lightbox`, clicking to the last item had left the arrow keys unheard, since focus fell outside its dialog.
