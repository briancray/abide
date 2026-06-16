import type { CacheSnapshotEntry } from './CacheSnapshotEntry.ts'

/*
Payload of one streamed `window.__abideResolve(...)` call. A full
`CacheSnapshotEntry` settles the placeholder with warm data; a `{ key, miss }`
marker means the server couldn't snapshot that body (binary, rejected, evicted)
so the client settles the placeholder with a live re-fetch instead. Discriminate
on the `miss` field.
*/
export type StreamedResolution = CacheSnapshotEntry | { key: string; miss: true }
