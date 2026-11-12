---
"@abide/abide": minor
---

a job can be spaced from its last run, put off at boot, and told to stop: `poll` takes `{ every, after: 'tick' | 'settle', delay }` beside a number, and `stopSignal()` is the signal `App.stop` aborts before it waits on a job's run — 7.20, 7.25, 7.32-7.39
