// IPC payload the dev server sends its orchestrator parent (via process.send)
// once its listener is up and init() has run. The orchestrator retires the
// previous worker only after this arrives — workers overlap on the dev port via
// reusePort, so the port never goes dark across a restart. Shared so producer
// (createServer) and consumer (devEntry) can't drift.
export const DEV_READY_MESSAGE = 'abide:ready'
