---
"@abide/abide": patch
---

the app's own process.exit ends the native app — on the launcher's thread it ended only the worker, leaving the window open over nothing and Quit waiting on an answer that never came ([`dff2a07`](https://github.com/briancray/abide/commit/dff2a07aba18eb7a7ba8f149449e4569c931a300))
