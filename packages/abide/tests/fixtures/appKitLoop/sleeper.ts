// The main thread asleep in AppKit (`appKitLoop`), and a worker on this same file reaching it.
// `message`: once the process has settled, the worker counts the Mach calls the process makes over
// an idle second, then posts it and wakes the main thread, which prints it. `signal`: the worker
// sends the process SIGTERM, and wakes the main thread a while later; the main thread prints whether
// its handler ran before that wake.
import { dlopen, FFIType, ptr } from 'bun:ffi'

import { objcClass, send, sendTyped } from '#server/appKit.ts'
import { onSignal, openWakePort, sleepInAppKit } from '#server/appKitLoop.ts'
import { wakeWindow } from '#server/wakeWindow.ts'

const SETTLE_MILLISECONDS = 1000
const IDLE_MILLISECONDS = 1000
// Where a signal never reaches the sleeping thread, a wake this much later ends its wait.
const LATE_WAKE_MILLISECONDS = 3000
const SIGTERM = 15
// TASK_EVENTS_INFO, whose sixth field is the task's Mach system calls.
const TASK_EVENTS_INFO = 2

type Started = { mode: string; port: number; lateWake: Int32Array }

if (Bun.isMainThread) {
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    // NSApplicationActivationPolicyProhibited: no Dock icon and no menu bar.
    sendTyped(
        application,
        'setActivationPolicy:',
        [FFIType.i64],
        FFIType.void,
        2,
    )
    send(application, 'finishLaunching')
    // Set by the worker as it sends the late wake.
    const lateWake = new Int32Array(new SharedArrayBuffer(4))
    onSignal(SIGTERM, () => {
        console.log(
            JSON.stringify({ beforeLateWake: Atomics.load(lateWake, 0) === 0 }),
        )
        process.exit(0)
    })
    const worker = new Worker(import.meta.path)
    worker.onmessage = ({ data }: MessageEvent<{ idleCalls: number }>) => {
        console.log(JSON.stringify(data))
        process.exit(0)
    }
    worker.postMessage({
        mode: Bun.argv[2] ?? 'message',
        port: openWakePort(),
        lateWake,
    } satisfies Started)
    sleepInAppKit(application)
} else {
    const KERNEL = dlopen('/usr/lib/libSystem.B.dylib', {
        task_self_trap: { args: [], returns: FFIType.u32 },
        task_info: {
            args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr],
            returns: FFIType.i32,
        },
    }).symbols
    const machCalls = (): number => {
        const info = new Int32Array(8)
        KERNEL.task_info(
            KERNEL.task_self_trap(),
            TASK_EVENTS_INFO,
            ptr(info),
            ptr(new Uint32Array([8])),
        )
        return info[5] ?? 0
    }
    const parent = globalThis as unknown as {
        postMessage(message: unknown): void
        onmessage: (event: MessageEvent<Started>) => void
    }
    parent.onmessage = ({ data }) =>
        setTimeout(() => {
            const from = machCalls()
            setTimeout(() => {
                const idleCalls = machCalls() - from
                if (data.mode === 'signal') {
                    process.kill(process.pid, 'SIGTERM')
                    setTimeout(() => {
                        Atomics.store(data.lateWake, 0, 1)
                        wakeWindow(data.port)
                    }, LATE_WAKE_MILLISECONDS)
                    return
                }
                parent.postMessage({ idleCalls })
                wakeWindow(data.port)
            }, IDLE_MILLISECONDS)
        }, SETTLE_MILLISECONDS)
}
