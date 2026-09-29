import type { App } from './createApp.ts'
import { reportUnexpected } from './hooks.ts'

/**
 * Stops the app through `App.stop` and exits on `SIGTERM`, `SIGINT` or a fault nobody awaited.
 *
 * 37.10, 37.11 — A SERVED APP ENDS THROUGH `App.stop`, however the process is told to go, so
 * `onStop` runs on a deploy's `SIGTERM` as it does on the shell's `exit`. A container's app is its
 * first process, and the kernel gives that one no default for `SIGTERM` — with no handler,
 * `docker stop` waits out its grace period and kills it, drain and `onStop` both skipped.
 *
 * A FAULT NOBODY AWAITED stops it too, after `onError` has it: the app's state is no longer one
 * anything vouched for, and a supervisor restarting a clean process is the recovery. The exit code
 * is what tells the supervisor which of the two it was.
 *
 * 37.12 — A SECOND SIGNAL WHILE STOPPING ENDS THE PROCESS AT ONCE, so a drain that never finishes
 * is still one keystroke from over.
 */
export function stopOnSignalOrFault(app: App): void {
    let stopping = false
    const stopThenExit = (code: number): void => {
        stopping = true
        app.stop().then(
            () => process.exit(code),
            (thrown) => {
                // 37.6 — a hook `onStop` wraps that throws fails hard.
                reportUnexpected(thrown)
                process.exit(1)
            },
        )
    }
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.on(signal, () => {
            if (stopping) process.exit(1)
            stopThenExit(0)
        })
    const fault = (error: unknown): void => {
        reportUnexpected(error)
        if (!stopping) stopThenExit(1)
    }
    process.on('unhandledRejection', fault)
    process.on('uncaughtException', fault)
}
