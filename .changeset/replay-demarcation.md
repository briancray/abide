---
"@belte/belte": minor
---

Replay is demarcated on the wire: a sub's seed now arrives as one per-sub `{ type: 'replay', sub, messages }` frame (sent even when empty) instead of socket-keyed `msg` frames.

- `tail()` windows commit their seed atomically at the boundary — no more shrink-regrow rebuild on reconnect or first paint — and an **empty** replay keeps the held window across a gap (nothing replayed = nothing to duplicate; live frames append). Previously the first post-gap frame wiped the window even on non-retaining sockets.
- Per-sub addressing fixes cross-sub replay leakage: two subs on the same socket no longer receive each other's replay.
- `Subscribable.tail(count, hooks?)` gains optional `TailHooks`: retaining sources must signal `hooks.replayed` in-band once the seed is delivered (sockets do; a source that ends without signalling commits at `done`).
- Internal: `createPushIterator` gains `control(run)` — in-band signal slots, strictly ordered against pushed values, invisible to consumers. Raw `for await` iteration is unchanged.
