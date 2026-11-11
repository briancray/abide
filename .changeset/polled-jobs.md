---
'@abide/abide': minor
---

A polled value no component or request owns is now a background job the app can stop cleanly. `reactive(async function* () { … }, { global: true, poll })` already ran on its clock with nobody reading it and never overlapped itself (7.20, 7.21). Now:

- `App.stop` stops the clock of every such poll before it drains (7.26), and once the requests have drained it waits for the run each one has in flight, before `onStop` and within `ABIDE_STOP_TIMEOUT` (7.27).
- A failed run of a polled value warns on `abide:reactive` with the value's name, and the next tick runs it again (7.28). This covers each keyed entry and a first run that fails.
