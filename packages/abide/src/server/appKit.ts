// THE OBJECTIVE-C RUNTIME, over `bun:ffi` — what the desktop launcher (`runDesktop`) drives AppKit
// and WebKit with. Bun's own `WebView` is headless, so a window and a menu bar are this module's.
//
// NO STRUCT IS PASSED BY VALUE. A `CGRect` is four doubles in registers on arm64 and a block on the
// stack on x86-64, and `bun:ffi` can only spell the first; every call here takes scalars and
// pointers, and a frame is set through `setContentSize:` — two doubles, the same in both ABIs.

import { CFunction, CString, dlopen, FFIType, JSCallback, read } from 'bun:ffi'

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
