---
"@abide/abide": minor
---

`listbox`'s keyboard listener is `onkeydown`, as every listener a headless component hands back or takes is named `on<event>` (RULEBOOK 49.13): write `onkeydown={queue.onkeydown}` where you wrote `onkeydown={queue.keydown}`.
