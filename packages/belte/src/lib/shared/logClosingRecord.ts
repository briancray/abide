import { emitLogRecord } from './emitLogRecord.ts'
import type { CacheStats } from './types/CacheStats.ts'

/*
Emits the request's closing record — the line that ends a trace: status as
the message, total duration at settle, cache read tallies frozen at that
moment. Framework-internal (runWithRequestScope at settle, the asset paths
directly); not part of the public log surface because its structured fields
only make sense at the request boundary the framework owns.
*/
export function logClosingRecord(
    method: string,
    path: string,
    status: number,
    durationMs: number,
    cache?: CacheStats,
): void {
    emitLogRecord({
        level: 'info',
        msg: '',
        channel: 'belte',
        method,
        path,
        status,
        durationMs,
        cache,
    })
}
