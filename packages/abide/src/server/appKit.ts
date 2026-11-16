// THE OBJECTIVE-C RUNTIME, over `bun:ffi` — what the native window (`openNativeWindow`) drives AppKit
// and WebKit with. Bun's own `WebView` is headless, so a window and a menu bar are this module's.
//
// NO STRUCT IS PASSED BY VALUE. A `CGRect` is four doubles in registers on arm64 and a block on the
// stack on x86-64, and `bun:ffi` can only spell the first; every call here takes scalars and
// pointers, and a frame is set through `setContentSize:` — two doubles, the same in both ABIs — and
// read through key-value coding, which boxes it in an `NSValue` that copies it into memory of ours.

import {
    CFunction,
    CString,
    dlopen,
    FFIType,
    JSCallback,
    read,
    toArrayBuffer,
} from 'bun:ffi'

export type Id = number | null

const RUNTIME = dlopen('/usr/lib/libobjc.A.dylib', {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_allocateClassPair: {
        args: [FFIType.ptr, FFIType.cstring, FFIType.u64],
        returns: FFIType.ptr,
    },
    objc_registerClassPair: { args: [FFIType.ptr], returns: FFIType.void },
    class_addMethod: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.cstring],
        returns: FFIType.bool,
    },
    // Called through `CFunction` at each signature it is sent with; this one is never called.
    objc_msgSend: { args: [], returns: FFIType.void },
    objc_autoreleasePoolPush: { args: [], returns: FFIType.ptr },
    objc_autoreleasePoolPop: { args: [FFIType.ptr], returns: FFIType.void },
})
const SYSTEM = dlopen('/usr/lib/libSystem.B.dylib', {
    malloc: { args: [FFIType.u64], returns: FFIType.ptr },
    free: { args: [FFIType.ptr], returns: FFIType.void },
    _Block_copy: { args: [FFIType.ptr], returns: FFIType.ptr },
    _Block_release: { args: [FFIType.ptr], returns: FFIType.void },
    // A class, not a function: only its address is read, as a block's `isa`.
    _NSConcreteGlobalBlock: { args: [], returns: FFIType.void },
})
// Loaded for the classes they register, which `objc_getClass` finds by name once they are.
dlopen('/System/Library/Frameworks/AppKit.framework/AppKit', {
    NSApplicationMain: { args: [], returns: FFIType.i32 },
})
dlopen('/System/Library/Frameworks/WebKit.framework/WebKit', {
    WKFrameInfoGetTypeID: { args: [], returns: FFIType.u64 },
})

const MSG_SEND = (RUNTIME.symbols.objc_msgSend as unknown as { ptr: number })
    .ptr

const ENCODER = new TextEncoder()
function text(value: string): Uint8Array {
    return ENCODER.encode(`${value}\0`)
}

const CLASSES = new Map<string, Id>()
/** The class registered under `name`. */
export function objcClass(name: string): Id {
    let found = CLASSES.get(name)
    if (found === undefined) {
        found = RUNTIME.symbols.objc_getClass(text(name)) as Id
        CLASSES.set(name, found)
    }
    return found
}

const SELECTORS = new Map<string, Id>()
/** The selector named `name`. */
export function selector(name: string): Id {
    let found = SELECTORS.get(name)
    if (found === undefined) {
        found = RUNTIME.symbols.sel_registerName(text(name)) as Id
        SELECTORS.set(name, found)
    }
    return found
}

// One `CFunction` per signature `objc_msgSend` is called at, built on first use.
type Sender = ReturnType<typeof CFunction>
const SENDERS = new Map<string, Sender>()
function sender(args: FFIType[], returns: FFIType): Sender {
    const key = `${args.join(',')}>${returns}`
    let found = SENDERS.get(key)
    if (found === undefined) {
        found = CFunction({
            ptr: MSG_SEND as never,
            args: [FFIType.ptr, FFIType.ptr, ...args],
            returns,
        })
        SENDERS.set(key, found)
    }
    return found
}

type Argument = Id | number | bigint | boolean | Uint8Array

/**
 * Sends `name` to `receiver` with arguments of the types `args` names, answering `returns`.
 *
 * The general form; `send` is the common case of objects in and an object back.
 */
export function sendTyped(
    receiver: Id,
    name: string,
    args: FFIType[],
    returns: FFIType,
    ...values: Argument[]
): unknown {
    return sender(args, returns)(receiver, selector(name), ...values)
}

/** Sends `name` to `receiver` with one `BOOL`, answering nothing — a flag's setter. */
export function sendFlag(receiver: Id, name: string, value: boolean): void {
    sendTyped(receiver, name, [FFIType.bool], FFIType.void, value)
}

/** Sends `name` to `receiver` with one number of `type` (an `NSInteger` by default), answering nothing. */
export function sendNumber(
    receiver: Id,
    name: string,
    value: number,
    type: FFIType = FFIType.i64,
): void {
    sendTyped(receiver, name, [type], FFIType.void, value)
}

/** Sends `name` to `receiver` with two doubles — a size or a point — answering nothing. */
export function sendPair(
    receiver: Id,
    name: string,
    first: number,
    second: number,
): void {
    sendTyped(
        receiver,
        name,
        [FFIType.f64, FFIType.f64],
        FFIType.void,
        first,
        second,
    )
}

/** What `receiver` answers `name` with, a `BOOL` getter taking nothing. */
export function flagOf(receiver: Id, name: string): boolean {
    return sendTyped(receiver, name, [], FFIType.bool) as boolean
}

/** The window's standard button `button` — close 0, miniaturize 1, zoom 2 (`NSWindowButton`). */
export function windowButton(window: Id, button: number): Id {
    return sendTyped(
        window,
        'standardWindowButton:',
        [FFIType.u64],
        FFIType.ptr,
        button,
    ) as Id
}

/** Sends `name` to `receiver`, every argument an object, answering an object. */
export function send(receiver: Id, name: string, ...values: Id[]): Id {
    const args: FFIType[] = []
    for (let at = 0; at < values.length; at += 1) args.push(FFIType.ptr)
    return sender(args, FFIType.ptr)(receiver, selector(name), ...values) as Id
}

/** A new instance of `className`, through `alloc` and `init`. */
export function created(className: string): Id {
    return send(send(objcClass(className), 'alloc'), 'init')
}

/** `value` as an `NSString`. */
export function nsString(value: string): Id {
    return sendTyped(
        objcClass('NSString'),
        'stringWithUTF8String:',
        [FFIType.ptr],
        FFIType.ptr,
        text(value),
    ) as Id
}

/** An `NSString` as text, or `''` where there is none. */
export function stringOf(value: Id): string {
    if (value === null || value === 0) return ''
    const bytes = send(value, 'UTF8String')
    return bytes === null ? '' : new CString(bytes as never).toString()
}

/** An `NSNumber` holding `value`. */
export function nsBoolean(value: boolean): Id {
    return sendTyped(
        objcClass('NSNumber'),
        'numberWithBool:',
        [FFIType.bool],
        FFIType.ptr,
        value,
    ) as Id
}

/** The `NSRect` `object` answers at `key`, as its origin and size: `[x, y, width, height]`. */
export function rectOf(
    object: Id,
    key: string,
): [number, number, number, number] {
    const bytes = new Uint8Array(32)
    sendTyped(
        send(object, 'valueForKey:', nsString(key)),
        'getValue:size:',
        [FFIType.ptr, FFIType.u64],
        FFIType.void,
        bytes,
        32,
    )
    const rect = new Float64Array(bytes.buffer)
    return [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0]
}

// Kept for the process's life: the runtime holds each one as a method's implementation.
const IMPLEMENTATIONS: JSCallback[] = []

/**
 * A class under `NSObject`, each method a function called with the receiver and its arguments.
 *
 * A method's `types` is its Objective-C encoding — `v@:@` is a `void` taking one object.
 */
export function definedClass(
    name: string,
    methods: Record<
        string,
        {
            types: string
            args: FFIType[]
            returns: FFIType
            run: (...values: never[]) => unknown
        }
    >,
): Id {
    const defined = RUNTIME.symbols.objc_allocateClassPair(
        objcClass('NSObject') as never,
        text(name),
        0,
    ) as Id
    for (const [method, { types, args, returns, run }] of Object.entries(
        methods,
    )) {
        const implementation = new JSCallback(
            (_receiver: Id, _selector: Id, ...values: never[]) =>
                run(...values),
            { args: [FFIType.ptr, FFIType.ptr, ...args], returns },
        )
        IMPLEMENTATIONS.push(implementation)
        RUNTIME.symbols.class_addMethod(
            defined as never,
            selector(method) as never,
            implementation.ptr as never,
            text(types),
        )
    }
    RUNTIME.symbols.objc_registerClassPair(defined as never)
    CLASSES.set(name, defined)
    return defined
}

/**
 * Calls a block AppKit or WebKit handed over, its arguments of the types `args` names.
 *
 * A block's function is the pointer 16 bytes in, called with the block first.
 */
export function callBlock(
    block: Id,
    args: FFIType[],
    ...values: Argument[]
): void {
    if (block === null || block === 0) return
    const invoke = CFunction({
        ptr: read.ptr(block as never, 16) as never,
        args: [FFIType.ptr, ...args],
        returns: FFIType.void,
    })
    invoke(block, ...values)
    invoke.close()
}

/**
 * Holds a block AppKit or WebKit handed over past the call that handed it, answering what calls it
 * once and then lets it go.
 */
export function callBlockLater(
    block: Id,
): (args: FFIType[], ...values: Argument[]) => void {
    const held = SYSTEM.symbols._Block_copy(block as never) as Id
    return (args, ...values) => {
        callBlock(held, args, ...values)
        SYSTEM.symbols._Block_release(held as never)
    }
}

// A block's layout: `isa`, flags, a reserved word, its function, its descriptor — and here the
// descriptor after it, a reserved word and the block's size.
const BLOCK_BYTES = 48
const BLOCK_SIZE = 32
const BLOCK_IS_GLOBAL = 1 << 28
const GLOBAL_BLOCK = (
    SYSTEM.symbols._NSConcreteGlobalBlock as unknown as { ptr: number }
).ptr

/**
 * A block for AppKit to call once, later, with arguments of the types `args` names.
 *
 * Global, so AppKit's copy of it is the block itself and nothing it captures is copied; its memory
 * and its function are let go at the main thread's next yield to bun (`appKitLoop`), once AppKit
 * has released it — not on a timer, which that thread runs only when something wakes it.
 *
 * `threadsafe` for a block called on a thread of the system's: `run` is queued to the thread that
 * made the block and runs after the call returns, so it may read the scalars it is handed and
 * nothing an object argument points to, which is let go by then.
 */
export function blockOnce(
    args: FFIType[],
    run: (...values: never[]) => void,
    threadsafe = false,
): Id {
    const memory = SYSTEM.symbols.malloc(BLOCK_BYTES) as number
    const implementation = new JSCallback(
        (_block: Id, ...values: never[]) => {
            run(...values)
            setImmediate(() => {
                implementation.close()
                SYSTEM.symbols.free(memory as never)
            })
        },
        { args: [FFIType.ptr, ...args], returns: FFIType.void, threadsafe },
    )
    const fields = new DataView(toArrayBuffer(memory as never, 0, BLOCK_BYTES))
    fields.setBigUint64(0, BigInt(GLOBAL_BLOCK), true)
    fields.setUint32(8, BLOCK_IS_GLOBAL, true)
    fields.setUint32(12, 0, true)
    fields.setBigUint64(16, BigInt(implementation.ptr as number), true)
    fields.setBigUint64(24, BigInt(memory + BLOCK_SIZE), true)
    fields.setBigUint64(32, 0n, true)
    fields.setBigUint64(40, BigInt(BLOCK_SIZE), true)
    return memory
}

/**
 * Runs `run` inside an autorelease pool, letting go of what AppKit autoreleased during it — which
 * `[NSApp run]` does for each event, and a drain on a timer has to do for itself.
 */
export function inAutoreleasePool(run: () => void): void {
    const pool = RUNTIME.symbols.objc_autoreleasePoolPush()
    try {
        run()
    } finally {
        RUNTIME.symbols.objc_autoreleasePoolPop(pool)
    }
}
