# ADR-0016: Tap and probe slots stay hand-rolled singles — no factory, no shape normalization

**Status:** accepted (2026-07-06)

## Context

An architecture review flagged the mutable dependency-inversion slots in
`lib/shared/` (`logTapSlot`, `socketTapSlot`, `tailProbeSlot`,
`outboxProbeSlot`, and the value-handoff slots) as a structurally repeated
family — each doc comment literally says "mirrors X" — and proposed
(a) a `createTap<T>()` factory behind the two inspector observation seams and
(b) normalizing `outboxProbeSlot` to return the same
`{ pending, refreshing, done, error }` record as `tailProbeSlot`, removing the
`field === 'pending'` guard in `probeRegistries`.

On inspection:

- Each slot's *implementation* is a one-line object literal (`{ tap:
  undefined }`). The substance of each module is its doc — what is observed,
  who installs the observer, and why exactly one — and those docs are
  genuinely per-seam. A factory would be a pass-through: deleting it makes no
  complexity reappear, the deletion-test signature of indirection that earns
  nothing.
- The probe-shape asymmetry is a domain fact, not a wart. Outbox state is
  pending-only: a parked durable write holds no value, so it can never be
  "refreshing" (nothing to supersede). `probeRegistries` reads the outbox
  prober only on its `pending` branch and deliberately last under `||`
  (monotonic-safe: a parked write can't flip a true result). Padding the
  prober to a fake `{ pending, refreshing: false, … }` record would bury that
  invariant in a manufactured shape and allocate a record per read for no
  consumer.

## Decision

Keep each slot a hand-rolled single-field module with its own doc. Keep the
outbox prober a bare boolean and the `field === 'pending'` guard in
`probeRegistries` as the visible encoding of "parked writes are pending-only"
(ADR-0003's probes-report contract).

## Consequences

- A new observation seam is written as its own slot module with its own doc,
  "mirrors X" included — the repetition is the documentation, not a defect.
- Re-propose a shared shape only if a probe source appears whose state
  genuinely spans both fields (a parked write that *can* refresh), which
  would change the domain fact, not just the plumbing.
