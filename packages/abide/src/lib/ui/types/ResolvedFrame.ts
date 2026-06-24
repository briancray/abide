import type { StreamedResolution } from '../../shared/types/StreamedResolution.ts'

/*
A warm-state-seed frame for the single client intake (`seedResolved`), discriminated by
`kind`. Both kinds ship a server-settled value so hydration adopts without a re-fetch,
but route to distinct stores:
  - `cache`  — a `StreamedResolution` for the cache store, read by a warm `cache()` call.
  - `resume` — an `await`-block boundary id plus its ref-json-encoded value STRING for the
               RESUME manifest, decoded lazily by `awaitBlock` when it adopts the branch.
The payloads stay distinct (cache snapshot vs boundary-keyed value); the unified thing is
the intake seam, not the payload.
*/
export type ResolvedFrame =
    | { kind: 'cache'; resolution: StreamedResolution }
    | { kind: 'resume'; id: number; resume: string }
