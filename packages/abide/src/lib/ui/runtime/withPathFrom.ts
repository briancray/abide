import { ambientPathBacking } from './ambientPathBacking.ts'
import { escapeKey } from './escapeKey.ts'

/*
Runs `build` with the render path set to `base` + one escaped `segment` (ADR-0033 D1). Unlike
`withPath` (which pushes relative to the LIVE ambient), this composes from an EXPLICIT base — for
a control-flow block that rebuilds content reactively AFTER mount, when the ambient path is no
longer on the stack. The block captures `CURRENT_PATH.current` at construction (its render-time
ancestry) and re-establishes `base/segment` for every branch/row build — initial and every later
swap — so a component or cell built on a swap still gets its full, stable id, not a bare segment.

Pushes through the backing's `run` (not a set-then-restore slot): the server's AsyncLocalStorage
backing makes the composed path survive an `await` inside `build`, so a render body resuming after
a cell barrier or child render reads its own path; the client's synchronous module-var `run` is a
plain save/restore. `run` returns `build()`'s value (a value on the client, a promise on the server).
*/
export function withPathFrom<T>(base: string, segment: string | number, build: () => T): T {
    const composedPath = base === '' ? escapeKey(segment) : `${base}/${escapeKey(segment)}`
    return ambientPathBacking.active.run(composedPath, build)
}
