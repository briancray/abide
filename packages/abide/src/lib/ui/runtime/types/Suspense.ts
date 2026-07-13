import type { SuspenseSignal } from '../SuspenseSignal.ts'

/*
A client suspense boundary — the runtime handle the compiler installs at a component root (when
the component has any blocking `await` cell) so a pending blocking read routes back to it instead
of rendering against `undefined` (ADR-0042 D3). `suspend(signal)` withholds the reading region and
subscribes to the signal's cell, revealing the region once it settles ("keep the watch"). The
scheduler (`flushEffects.drain`) calls it when a node associated with this boundary (`suspenseFor`)
throws a `SuspenseSignal` during a flush. Distinct from `Boundary` so the two channels never cross:
a suspend is "no value yet," never an error, and must never reach an author's `{#try}`/`{:catch}`.
*/
export type Suspense = { suspend(signal: SuspenseSignal): void }
