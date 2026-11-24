---
"@abide/abide": minor
---

`drawer`, a composed part. `drawer({ side })` is a `dialog` with a `resizable`'s panel laid over it: spread `drawer` on a `<dialog>` and `handle` on its inner edge, and it opens and dismisses as a dialog does, sizes from its handle as a resizable does, and carries `data-side` for the edge your CSS puts it on (50.61, 50.62). Give it `stops` and its handle, let go, settles it at the nearest stop — a flick carrying it on — and closes it below every stop, on any edge: `drawer({ side: 'bottom', stops: [0.5, 1] })` is a bottom sheet (50.63, 50.64).
