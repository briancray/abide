import type { LogRecord } from './types/LogRecord.ts'

/*
Passive observation seam for the unified log. emitLogRecord calls the tap (when
set) with every fully-built record, before formatting — so an observer sees the
exact structured record stdout/console would, trace context and all. The
inspector installs one to feed its live event buffer; unset everywhere else, so
the call no-ops with zero allocation. One slot, not a listener set: the single
in-process observer fans out to its own readers. Mirrors requestScopeSlot.
*/
export const logTapSlot: { tap: ((record: LogRecord) => void) | undefined } = {
    tap: undefined,
}
