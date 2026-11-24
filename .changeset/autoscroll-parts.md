---
"@abide/abide": minor
---

Breaking: `followBottom` is renamed `autoscroll`, and is a headless component. `autoscroll(options?)` hands back `host` to spread on the scroller, `jump` to spread on a button that shows once the reader has scrolled up (with `data-unseen` once something arrived meanwhile) and takes them back down, `following` as a `Reactive`, and `toBottom()`. Options: `following`, `threshold` and `behavior`. `bind:element={followBottom}` becomes `{...follow.host}` from `const follow = autoscroll()`, and `data-follow-bottom` is `data-autoscroll`. `Chat` renders the jump button as its `jump` part (RULEBOOK 53.39, 53.50, 53.58-53.60).
