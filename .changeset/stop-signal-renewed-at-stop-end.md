---
'@abide/abide': patch
---

`stopSignal()` is aborted for exactly the stop: from the moment `App.stop` begins until it resolves, `onStop` included, and a fresh, unaborted signal from then on. It used to stay aborted until the next `createApp`, so code linking it after an earlier app's stop in the same process — a test file — was handed a signal that already said stop.
