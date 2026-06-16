/*
Tie the embedded server's lifetime to the bundle launcher's.

The launcher spawns this server with ABIDE_PARENT_PID set to its own pid. On a
clean window close the launcher reaps the child directly, but a force-quit (or
crash) of the launcher can't run that cleanup, which would leave the server
orphaned and holding its port. So when that env var is present, poll the parent
and exit once it's gone. A no-op when the var is absent (standalone `abide
start`), so it only ever activates inside a bundle.
*/
export function exitWithParent(): void {
    const parent = process.env.ABIDE_PARENT_PID
    if (!parent) {
        return
    }
    const parentPid = Number(parent)
    const timer = setInterval(() => {
        try {
            // Signal 0 sends nothing — it only probes existence, throwing when the
            // parent has exited (or its pid is no longer reachable).
            process.kill(parentPid, 0)
        } catch {
            process.exit(0)
        }
    }, 1000)
    // The watchdog alone shouldn't keep the server process alive.
    timer.unref()
}
