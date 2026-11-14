// 38.179 — THE MAIN THREAD SLEEPS INSIDE APPKIT'S OWN WAIT, which is the only place AppKit's event thread and
// WebKit reach it: both wake the run loop with `CFRunLoopWakeUp`, which CoreFoundation drops unless
// the loop is waiting. Bun's loop on this thread runs only between waits, so nothing that needs it —
// a timer, a socket, a fetch — belongs on this thread: the launcher's thread (`runNative`) holds
// all of that, and reaches this one by a Mach message to the wake port, which queues where a
// wake-up would be dropped. A signal reaches it through libdispatch's main queue, which the wait
// services.

import { dlopen, FFIType, JSCallback, read } from 'bun:ffi'

import {
    type Id,
    inAutoreleasePool,
    nsString,
    objcClass,
    send,
    sendTyped,
} from './appKit.ts'

const FOUNDATION = dlopen(
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
    {
        CFMachPortCreate: {
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.ptr,
        },
        CFMachPortGetPort: { args: [FFIType.ptr], returns: FFIType.u32 },
        CFMachPortCreateRunLoopSource: {
            args: [FFIType.ptr, FFIType.ptr, FFIType.i64],
            returns: FFIType.ptr,
        },
        CFRunLoopGetMain: { args: [], returns: FFIType.ptr },
        CFRunLoopAddSource: {
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.void,
        },
        // A constant, not a function: CoreFoundation knows the common modes by this pointer, and
        // a string of the same text would name a mode of its own.
        kCFRunLoopCommonModes: { args: [], returns: FFIType.void },
    },
)
const DISPATCH = dlopen('/usr/lib/libSystem.B.dylib', {
    dispatch_source_create: {
        args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr],
        returns: FFIType.ptr,
    },
    dispatch_source_set_event_handler_f: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
    },
    dispatch_resume: { args: [FFIType.ptr], returns: FFIType.void },
    signal: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    // Constants, not functions: only their addresses are read.
    _dispatch_source_type_signal: { args: [], returns: FFIType.void },
    _dispatch_main_q: { args: [], returns: FFIType.void },
})

function addressOf(symbol: unknown): number {
    return (symbol as { ptr: number }).ptr
}

// NSEventTypeApplicationDefined: what ends the wait for the wake port.
const APPLICATION_DEFINED = 15
// Kept for the process's life: CoreFoundation and libdispatch hold each one as a callout.
const CALLOUTS: JSCallback[] = []

/**
 * The Mach port a message to which wakes the main thread out of AppKit's wait, so bun delivers
 * what the launcher's thread posted it. Opened before the thread sleeps; a message sent before then
 * waits in the port.
 */
export function openWakePort(): number {
    const application = send(objcClass('NSApplication'), 'sharedApplication')
    const callout = new JSCallback(
        () =>
            send(
                application,
                'postEvent:atStart:',
                sendTyped(
                    objcClass('NSEvent'),
                    'otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:',
                    [
                        FFIType.u64,
                        FFIType.f64,
                        FFIType.f64,
                        FFIType.u64,
                        FFIType.f64,
                        FFIType.i64,
                        FFIType.ptr,
                        FFIType.i16,
                        FFIType.i64,
                        FFIType.i64,
                    ],
                    FFIType.ptr,
                    APPLICATION_DEFINED,
                    0,
                    0,
                    0,
                    0,
                    0,
                    null,
                    0,
                    0,
                    0,
                ) as Id,
                null,
            ),
        {
            args: [FFIType.ptr, FFIType.ptr, FFIType.i64, FFIType.ptr],
            returns: FFIType.void,
        },
    )
    CALLOUTS.push(callout)
    const port = FOUNDATION.symbols.CFMachPortCreate(
        null,
        callout.ptr,
        null,
        null,
    )
    // Common modes, so a wake lands in a menu held open or a resize too, and waits for it to end.
    FOUNDATION.symbols.CFRunLoopAddSource(
        FOUNDATION.symbols.CFRunLoopGetMain(),
        FOUNDATION.symbols.CFMachPortCreateRunLoopSource(null, port, 0),
        read.ptr(
            addressOf(FOUNDATION.symbols.kCFRunLoopCommonModes) as never,
            0,
        ) as never,
    )
    return FOUNDATION.symbols.CFMachPortGetPort(port)
}

/**
 * Runs `run` on the main thread when the process is sent `signal`, inside AppKit's wait — where a
 * `process.on` handler would wait for the thread to wake for something else. The signal's own
 * action is set aside, so it no longer ends the process.
 */
export function onSignal(signal: number, run: () => void): void {
    const handler = new JSCallback(run, {
        args: [FFIType.ptr],
        returns: FFIType.void,
    })
    CALLOUTS.push(handler)
    // SIG_IGN.
    DISPATCH.symbols.signal(signal, 1 as never)
    const source = DISPATCH.symbols.dispatch_source_create(
        addressOf(DISPATCH.symbols._dispatch_source_type_signal) as never,
        signal,
        0,
        addressOf(DISPATCH.symbols._dispatch_main_q) as never,
    )
    DISPATCH.symbols.dispatch_source_set_event_handler_f(source, handler.ptr)
    DISPATCH.symbols.dispatch_resume(source)
}

/**
 * Hands the main thread to AppKit for good, from the next turn of bun's loop: each turn waits for
 * an event and dispatches it, then yields to bun once, which delivers whatever woke it.
 */
export function sleepInAppKit(application: Id): void {
    const distantFuture = send(objcClass('NSDate'), 'distantFuture')
    const defaultMode = nsString('kCFRunLoopDefaultMode')
    const turn = (): void => {
        inAutoreleasePool(() => {
            const event = sendTyped(
                application,
                'nextEventMatchingMask:untilDate:inMode:dequeue:',
                [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.bool],
                FFIType.ptr,
                0xffffffffffffffffn,
                distantFuture,
                defaultMode,
                true,
            ) as Id
            if (event !== null) send(application, 'sendEvent:', event)
        })
        setImmediate(turn)
    }
    setImmediate(turn)
}
