import type { LogRecord } from '../../../shared/types/LogRecord.ts'
import type { InspectorCacheSnapshot } from './InspectorCacheSnapshot.ts'
import type { InspectorSurface } from './InspectorSurface.ts'

/*
The capabilities core injects into `@abide/inspector` when
ABIDE_ENABLE_INSPECTOR=true. The package consumes this and imports no abide
internals — so the inspector stays a pure consumer and core grows no public
surface for it (mirrors how AppModule / AgentEngine are the documented seams).
Everything here is already produced by the runtime: the registries behind
loadSurface(), the log chokepoint behind onRecord().
*/
// @readme plumbing
export type InspectorContext = {
    /* App identity for the UI header — the same name/version the health probe reports. */
    app: { name: string; version: string }
    /* Eager-loads the registries, then projects the current RPC + socket catalog. */
    loadSurface: () => Promise<InspectorSurface>
    /* Snapshots the persistent (global) cache store — current entries with their
       lifecycle state, retention, tags, and a value preview. */
    cacheSnapshot: () => InspectorCacheSnapshot
    /*
    Subscribes to the unified event stream: every emitted log record (the log's
    structured form, trace context and all) plus published socket frames shaped
    as `socket`-channel records — one feed, so the inspector treats sockets,
    cache diagnostics, and request logs uniformly. Returns an unsubscribe; the
    underlying taps are process-wide, owned by the inspector for its lifetime.
    */
    onRecord: (listener: (record: LogRecord) => void) => () => void
}
