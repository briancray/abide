---
"@belte/belte": patch
---

`belte dev` restarts are now zero-downtime: the replacement worker boots alongside the incumbent (both bind the dev port via `reusePort`) and the old worker is retired only once the new one reports ready, so requests never hit a dead port mid-rebuild. A worker that crashes while active is respawned automatically (bounded, so a crash-on-boot loop gives up until the next save), and a replacement that dies or hangs booting is discarded while the last-good server keeps serving.
