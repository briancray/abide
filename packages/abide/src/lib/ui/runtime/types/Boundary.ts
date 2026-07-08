/*
A reactive error boundary — the runtime handle a `{#try}` installs so a LATER re-run
throw from a guarded effect (an async cell that rejects after mount, read via a throwing
peek) routes back to it. `handle(error)` swaps the guarded content to the catch branch;
the scheduler (`flushEffects.drain`) calls it when a node associated with this boundary
(`boundaryFor`) throws during a flush. Kept minimal so the boundary can install itself as
the ambient `CURRENT_BOUNDARY` around a guarded build without dragging DOM types here.
*/
export type Boundary = { handle(error: unknown): void }
