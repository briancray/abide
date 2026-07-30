// installShutdownHandlers(running) — process-level shutdown for a long-lived abide server (CL2).
//
// Two triggers route through one path so the app's `onStop` teardown (drain + close) always runs
// before exit instead of stranding in-flight work:
//   - a crash (uncaughtException / unhandledRejection) → teardown, then exit 1;
//   - a signal (SIGINT / SIGTERM, e.g. Ctrl-C or a container stop) → graceful teardown, then exit 0.
// `running.stop()` drives onStop and its teardown backstop. Installed once per boot; a second trigger
// DURING teardown falls through the re-entrancy guard so the pending exit still fires, and a stalled
// teardown is force-exited by the deadline. Not wired into `serve()` itself — that's a library entry
// the test suite boots repeatedly, and per-boot exit handlers there would be wrong. The callers are
// the ones that OWN the process: `abide dev`/`start`/`scaffold`, and a compiled binary's boot.

import type { ServeResult } from '../server/internal/hostApp.ts'
import { log } from '../shared/log.ts'

// Grace window for onStop teardown during shutdown before the process is force-exited — a buggy hook
// that never resolves must not turn a crash or a Ctrl-C into a hang.
const SHUTDOWN_TEARDOWN_DEADLINE_MS = 5000

export function installShutdownHandlers(running: ServeResult): void {
    // On the framework's own channel rather than bare `console`, so shutdown lines carry the same
    // level/time/traceparent shape as everything else and honour ABIDE_LOG_FORMAT / NO_COLOR. The
    // routine "tearing down" notice is gated with the rest of `abide:cli`; the three FAILURE lines
    // below are `error`, which bypasses gating — so a stalled or throwing teardown still surfaces on
    // a silent channel, which is the case that actually needs saying.
    const shutdownLog = log.channel('abide:cli')
    let shuttingDown = false
    const shutdown = async (reason: string, exitCode: number, cause?: unknown): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        if (cause !== undefined) {
            shutdownLog.error(`${reason} — running onStop teardown before exit:`, cause)
        } else {
            shutdownLog.info(`${reason} — running onStop teardown before exit.`)
        }
        // Force-exit if teardown stalls (a hanging onStop) so shutdown never hangs. Unref'd so the timer
        // itself never keeps the process alive. A timed-out teardown is abnormal, so it always exits 1.
        const deadline = setTimeout(() => {
            shutdownLog.error('onStop teardown timed out during shutdown — forcing exit.')
            process.exit(1)
        }, SHUTDOWN_TEARDOWN_DEADLINE_MS)
        deadline.unref?.()
        try {
            await running.stop()
        } catch (stopError) {
            shutdownLog.error('onStop teardown itself failed during shutdown:', stopError)
            process.exit(1)
        }
        process.exit(exitCode)
    }
    process.on('uncaughtException', (error) => void shutdown('uncaught exception', 1, error))
    process.on('unhandledRejection', (reason) => void shutdown('unhandled rejection', 1, reason))
    process.on('SIGINT', () => void shutdown('SIGINT', 0))
    process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
}
