---
"@abide/abide": patch
---

An open hint is the top layer of `dismissible`'s stack, so an Escape closes the hint alone and is prevented: the panel or the `<dialog>` under it stays open for the next Escape, where before one Escape closed both. A hint now also yields an Escape a focused field already took (RULEBOOK 50.25, 53.15).
