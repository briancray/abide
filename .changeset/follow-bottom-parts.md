---
"@abide/abide": minor
---

Breaking: `followBottom` is a parts function. `followBottom(options?)` hands back `host` to spread on the scroller, `jump` to spread on a button that shows once the reader has scrolled up (with `data-unseen` once something arrived meanwhile) and takes them back down, `following` as a `Reactive`, and `toBottom()`. Options: `following`, `threshold` and `behavior`. `bind:element={followBottom}` becomes `{...follow.host}`. `Chat` renders the jump button as its `jump` part (RULEBOOK 53.40, 53.53, 53.61-53.63).
