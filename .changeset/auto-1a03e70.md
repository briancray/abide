---
"@abide/abide": patch
---

nothing on the window's main thread waits on bun's own loop — a sheet's block is freed at the thread's next yield rather than on a timer it runs only when woken, and a test walks the window's modules from where the thread starts and names any timer, fetch, file, child or signal handler in them ([`1a03e70`](https://github.com/briancray/abide/commit/1a03e706b939b62588b9799874dd401361a75866))
