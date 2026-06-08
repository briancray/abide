// IPC payload the dev server sends its orchestrator parent (via process.send) to
// request a rebuild + restart. Shared so producer (createServer) and consumer
// (devEntry) can't drift.
export const DEV_REBUILD_MESSAGE = 'belte:reload'
