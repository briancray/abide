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
  - `cache` is the inline warm-seed partition, drained through `seedResolved`;
  - `route`/`params`/`trace` are stamped for inspectability and trace continuity and
    are NOT read by the client (the router re-resolves the route from the URL).
*/
export type SsrPayload = SsrBootState & {
    route: string
    params: Record<string, string>
    cache?: CacheSnapshotEntry[]
    trace: string
}
