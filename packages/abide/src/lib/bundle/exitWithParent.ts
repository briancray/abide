/*
Tie this server's lifetime to its launcher's.

The launcher (a bundle, or the dev orchestrator) spawns this server with
ABIDE_PARENT_PID set to its own pid. On a clean shutdown the launcher reaps the
child directly, but a force-quit or crash of the launcher can't run that
cleanup, which would leave the server orphaned and holding its port. So when
that env var is present, poll the parent and exit once it's gone. A no-op when
the var is absent (standalone `abide start`).
*/
export function exitWithParent(): void {
    const parent = process.env.ABIDE_PARENT_PID
    const parentPid = Number(parent)
    /* A non-numeric value is truthy but coerces to NaN; without the integer guard
       process.kill(NaN, 0) throws on the first tick and exits a healthy server. */
    if (!parent || !Number.isInteger(parentPid)) {
        return
    }
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
