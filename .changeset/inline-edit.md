---
"@abide/abide": minor
---

`inlineEdit({ value, save })`, a value edited where it stands: spread `view` on a button showing it and `input` on a field. A press opens the field holding the value, selected; Enter or leaving it calls `save` and waits on it before `value` changes, Escape puts it back, and focus returns to the button. A save that throws keeps the field open with `error` naming why, the field disabled while one is in flight (56.24-56.28).
