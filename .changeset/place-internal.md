---
"@abide/abide": minor
---

`place` is internal: an app's own overlay is a `popover`, which places it, keeps it placed as anything moves, and writes `data-side`, `--arrow-offset` and `--anchor-width`. Migrate `place(anchor, floating, options)` and the `inset` you wrote from it to `bind:element={popover(anchor, options)}` on the floating element. `PlaceOptions` is `PopoverOptions`, and `Placement` is gone; `Side` stays. 50.19-50.22 and 50.35 now govern every anchored layer (RULEBOOK 50.19-50.22, 50.26, 50.27, 50.35).
