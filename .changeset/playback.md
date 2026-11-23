---
"@abide/abide": minor
---

`playback({ duration })`, a clock and its controls for replays, animations and timelines: one frame loop moves `at` while `playing`, by the time passed times `rate`, stopping or starting over at its end (51.130, 51.131). Its parts are made of public ones — `play` is a `toggle`'s button, `speed` a `toggleGroup` over `rates`, and `root` binds Space and the arrows with `hotkeys` — beside a `scrubber` for an `<input type="range">` (51.132-51.135).
