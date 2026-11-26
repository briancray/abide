---
"@abide/abide": patch
---

An entry a `memo`'s `throttle` or `debounce` window starts onto a call that is refused at once no longer stays busy: the busy was the window's and ends with the hold, so an `await` on it resolves to the refusal (5.20).
