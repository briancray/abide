---
"@abide/abide": patch
"@abide/bridge": patch
---

the native app finds claude on the login shell's PATH when opened from the Finder — Bun.which and Bun.spawn read the PATH the process started with, so localStands passes the current PATH and a turn's spawn hands the child the current env; the 44.77 test now starts with no claude on PATH and assigns it after, as runNative does ([`26a24cb`](https://github.com/briancray/abide/commit/26a24cbd98ebc248dce33a17fb0f5a28521247d4))
