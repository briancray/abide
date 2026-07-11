import { cellBarrierBacking } from './runtime/cellBarrierBacking.ts'

/*
Runs a hoisted child render (`$$isolateCellBarrier`) under its OWN async-cell barrier list, so its
cells register and its `$$settleAsyncCells` drain are isolated from every concurrent sibling and from
the page (ADR-0037 Phase 2). Wraps the render start emitted by the SSR flight hoist:
`$$flight(() => $$isolateCellBarrier(() => $$withPath(ordinal, () => Child.render(props, $ctx))))`.
The server backing runs it inside an AsyncLocalStorage so the fresh list is inherited across the
child render's own awaits (its top-level script await, its barrier); the default (client / no server
install) backing is an inert passthrough — the client mounts synchronously and has no SSR barrier, so
there is nothing to isolate. Only the pending (barrier) list is isolated; resolved/streamed cell
values still aggregate on the per-request store for the warm-seed snapshot.
*/
// @documentation plumbing
export function isolateCellBarrier<T>(render: () => T): T {
    return cellBarrierBacking.active.run({ promises: [] }, render)
}
