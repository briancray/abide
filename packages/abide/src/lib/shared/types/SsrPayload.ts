import type { CacheSnapshotEntry } from './CacheSnapshotEntry.ts'
import type { SsrBootState } from './SsrBootState.ts'

/*
The `window.__SSR__` payload: the single contract between the server's SSR state tag
(`createUiPageRenderer.stateTag`) and the client entry (`startClient`). Both sides
import THIS type — the server stamps its object with `satisfies SsrPayload` (an unknown
or mis-typed field is a compile error) and the client reads through it — so the
write-set and read-set can't drift apart on a matching-string-key handshake.

Three partitions:
  - `SsrBootState` fields seed ambient slots via the exhaustive `seedBootState` map;
  - `cache` / `cells` are the warm-seed partitions (settled `cache()` values / resolved async-cell
    values), drained into their client stores before mount;
  - `route`/`params` are stamped for inspectability and are NOT read by the client
    (the router re-resolves the route from the URL).
*/
export type SsrPayload = SsrBootState & {
    route: string
    params: Record<string, string>
    cache?: CacheSnapshotEntry[]
    /* Async-cell values that resolved during SSR, keyed by render-path id → ref-json string.
       `startClient` seeds these into `CELL_SEED`; a hydrating cell reads its key to warm-hydrate. */
    cells?: Record<string, string>
    /* Reactive-document snapshots that carried synchronous `state` during SSR, keyed by render-path
       id → ref-json string. `startClient` seeds these into `DOC_SEED`; a hydrating scope's first
       write to each slot adopts the server value, so a plain `state(uuid())`/`state(Date.now())`
       keeps the SSR value instead of recomputing a divergent one. */
    docs?: Record<string, string>
    /* Retained socket frames read via `peek(socket)` during SSR, keyed by socket name → ref-json
       string. `startClient` seeds these into `SOCKET_SEED`; a hydrating `socketProxy` adopts the frame
       as its `lastFrame` so `peek(socket)` returns the SAME retained value the server rendered instead
       of `undefined` on the not-yet-connected client — otherwise the two disagree and hydration
       discards the server markup. */
    sockets?: Record<string, string>
}
