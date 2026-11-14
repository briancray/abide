// The launcher's thread's half of `appKitLoop`'s wake port: a Mach message, which queues where a
// run loop wake-up would be dropped, sent with no wait — a full queue already wakes the window.

import { dlopen, FFIType, ptr } from 'bun:ffi'

const KERNEL = dlopen('/usr/lib/libSystem.B.dylib', {
    mach_msg: {
        args: [
            FFIType.ptr,
            FFIType.i32,
            FFIType.u32,
            FFIType.u32,
            FFIType.u32,
            FFIType.u32,
            FFIType.u32,
        ],
        returns: FFIType.i32,
    },
})

// A `mach_msg_header_t` and nothing after it.
const HEADER_BYTES = 24
// MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0).
const COPY_SEND = 19
// MACH_SEND_MSG | MACH_SEND_TIMEOUT.
const SEND_WITHOUT_WAITING = 0x11

const header = new Uint8Array(HEADER_BYTES)
const fields = new DataView(header.buffer)
fields.setUint32(0, COPY_SEND, true)
fields.setUint32(4, HEADER_BYTES, true)

/** Wakes the main thread out of AppKit's wait, so it takes what was posted to it. */
export function wakeWindow(port: number): void {
    fields.setUint32(8, port, true)
    KERNEL.symbols.mach_msg(
        ptr(header),
        SEND_WITHOUT_WAITING,
        HEADER_BYTES,
        0,
        0,
        0,
        0,
    )
}
