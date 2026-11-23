---
"@abide/abide": minor
---

`drawer` and `sheet`, composed parts. `drawer({ side })` is a `dialog` with a `resizable`'s panel laid over it: spread `drawer` on a `<dialog>` and `handle` on its inner edge, and it opens and dismisses as a dialog does, sizes from its handle as a resizable does, and carries `data-side` for the edge your CSS puts it on (50.61, 50.62). `sheet({ stops })` is a drawer on the bottom edge whose handle, let go, settles it at the nearest stop — a flick carrying it on — and closes it below every stop (50.63, 50.64).
