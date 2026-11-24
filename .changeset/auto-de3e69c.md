---
"@abide/abide": patch
---

a global production's Direct duration is timed from before the call — the call starts its body, so its work before the first await, and any pause before the clock was read, went uncounted; a loaded CI box read 35 ms for a 50 ms sleep — RULEBOOK 21.15 ([`de3e69c`](https://github.com/briancray/abide/commit/de3e69c48604af60e66b42c2c836269210e379a3))
