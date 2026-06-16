---
"abide": patch
---

Fix an infinite loop when a `derived` over a `createSubscriber`-backed resource (e.g. `tail()` of a socket) is read by an effect. `trigger` walked the live observer `Set` while the flush it fired synchronously recomputed the derived, whose `runNode` deletes-then-re-adds itself to that same set — re-yielding it to the in-progress `for…of` forever. Invalidation now snapshots each observer set and the queued effects flush once at the outermost trigger, never mid-propagation.
