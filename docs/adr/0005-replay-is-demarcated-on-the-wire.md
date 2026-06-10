# ADR-0005: Replay is demarcated on the wire

**Status:** accepted (2026-06-09)

## Context

After ADR-0004, a sub's seed was replayed as ordinary socket-keyed `msg`
frames — byte-identical to live frames. The client could not see where replay
ended, which forced the `tail()` window consumer into replace-on-first-frame
heuristics with three concrete defects:

- **Shrink-regrow flash.** A reconnecting window collapsed to the first
  replayed frame and rebuilt one update at a time (`[a,b,c]` → `[b]` →
  `[b,c]` → `[b,c,d]`). Usually sub-paint-frame, never guaranteed. The same
  staircase applied to a window's *initial* seed.
- **Wipe on a non-retaining socket.** With nothing to replay, the first
  *live* frame after a gap was indistinguishable from replay and wiped a
  legitimately-held window — frames destroyed when duplication wasn't even
  possible. Unfixable client-side: capability presence ≠ retention; only the
  wire knows what was replay.
- **Cross-sub replay leakage.** Replay frames were keyed by socket, and the
  client demuxes socket-keyed frames to every local sub of that socket — two
  subs on one socket each received the other's replay.

A timing heuristic ("frames arriving within X ms are replay") was rejected:
it guesses wrong exactly on the bad networks where reconnects happen.

## Decision

The seed is one per-sub batch, and the boundary is part of the read contract:

- **Wire:** the dispatcher answers `sub` with a single
  `{ type: 'replay', sub, messages }` frame — always, even when `messages`
  is empty — then live fan-out rides the Bun topic as before. Batching is
  the demarcation; per-sub addressing ends the leakage. `end`/`err`/`msg`
  are unchanged.
- **Capability:** `Subscribable.tail(count, hooks?)` accepts optional
  `TailHooks`. Implementers must signal `hooks.replayed` in-band exactly
  once — after the last replayed frame, before any live frame, even when
  nothing was replayed. socketProxy signals it by unpacking the `replay`
  frame; defineSocket signals it after pushing its in-process replay; rpc
  streams have no capability and no boundary.
- **In-band transport:** `createPushIterator` gained `control(run)` — a
  queued slot executed inside `next()`, strictly ordered against pushed
  values and invisible to the consumer. This is what keeps the boundary
  honest: a plain callback could outrun frames still queued in the iterator.
- **Consumer:** `tail()` seeds-and-commits. While seeding, frames accumulate
  silently (capped at `last`); at the boundary the seed commits to the
  window in one update. Non-empty seed replaces the window (append would
  duplicate); empty seed keeps the held window and ends the `refreshing`
  gap; live frames append after. A capability source that ends without
  signalling commits its seed at `done` (safety net). Sources without the
  capability append directly — and after a gap they *append*, never wipe,
  since nothing replayed.

## Consequences

- Reconnecting and first-paint windows update atomically — no intermediate
  states, honoring the no-flash rule at the protocol level rather than by
  timing luck.
- A held window now survives a gap on a non-retaining socket; frames
  published during the gap are still lost (no retention — by design).
- The capability signature is part of the public Subscribable contract:
  custom retaining sources must signal the boundary or fall back to
  commit-at-done.
- Frames published between the topic join and the snapshot can still appear
  in both replay and live (pre-existing); payloads needing exactly-once
  ordering should carry an id/timestamp. Frame-identity dedupe remains out
  of scope.
- Raw `for await` consumers are untouched: control slots are invisible, and
  hook-less iteration behaves exactly as before.
