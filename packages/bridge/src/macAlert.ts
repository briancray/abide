// THE QUESTION AS macOS's OWN ALERT, over the Objective-C runtime through `bun:ffi`: an `NSAlert` this
// process shows itself, so it comes to the front, carries the asking app's icon, and answers which
// button was pressed. abide drives AppKit the same way (`packages/abide/src/server/appKit.ts`), and
// exports none of it; the handler is bundled into one file, so this is the few calls an alert needs.
//
// LOADED WHEN ASKED, never at import: the handler runs on Linux and Windows too, where neither library
// is there to open.

import { CFunction, dlopen, FFIType } from 'bun:ffi'

type Id = number | null

/** The first button's answer from `runModal`; each button after it answers one more. */
const FIRST_BUTTON = 1000
// NSApplicationActivationPolicyAccessory: in front of the browser, with no Dock icon of its own.
const ACCESSORY = 1
// NSAlertStyleWarning: the alert's own icon, with nothing laid over it.
const WARNING = 0

const ENCODER = new TextEncoder()
function text(value: string): Uint8Array {
    return ENCODER.encode(`${value}\0`)
}

/**
 * Shows `headline` in bold over `body`, with `icon` where it is an image macOS reads, and `buttons`
 * right to left — the first is pressed by Return. Answers the index of the button pressed.
 */
export function macAlert(
    headline: string,
    body: string,
    icon: Uint8Array | undefined,
    buttons: readonly string[],
): number {
    const runtime = dlopen('/usr/lib/libobjc.A.dylib', {
        objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
        sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
        objc_msgSend: { args: [], returns: FFIType.void },
    })
    // Loaded for the classes it registers, which `objc_getClass` then finds by name.
    dlopen('/System/Library/Frameworks/AppKit.framework/AppKit', {
        NSApplicationMain: { args: [], returns: FFIType.i32 },
    })
    const messenger = (
        runtime.symbols.objc_msgSend as unknown as { ptr: number }
    ).ptr
    const senders = new Map<string, ReturnType<typeof CFunction>>()
    function sendTyped(
        receiver: Id,
        name: string,
        args: FFIType[],
        returns: FFIType,
        ...values: (Id | number | Uint8Array | boolean)[]
    ): unknown {
        const key = `${args.join(',')}>${returns}`
        let sender = senders.get(key)
        if (sender === undefined) {
            sender = CFunction({
                ptr: messenger as never,
                args: [FFIType.ptr, FFIType.ptr, ...args],
                returns,
            })
            senders.set(key, sender)
        }
        return sender(
            receiver,
            runtime.symbols.sel_registerName(text(name)),
            ...values,
        )
    }
    const send = (receiver: Id, name: string, ...values: Id[]): Id =>
        sendTyped(
            receiver,
            name,
            values.map(() => FFIType.ptr),
            FFIType.ptr,
            ...values,
        ) as Id
    const classNamed = (name: string): Id =>
        runtime.symbols.objc_getClass(text(name)) as Id
    const string = (value: string): Id =>
        sendTyped(
            classNamed('NSString'),
            'stringWithUTF8String:',
            [FFIType.ptr],
            FFIType.ptr,
            text(value),
        ) as Id

    try {
        const application = send(
            classNamed('NSApplication'),
            'sharedApplication',
        )
        sendTyped(
            application,
            'setActivationPolicy:',
            [FFIType.i64],
            FFIType.bool,
            ACCESSORY,
        )
        send(application, 'finishLaunching')
        sendTyped(
            application,
            'activateIgnoringOtherApps:',
            [FFIType.bool],
            FFIType.void,
            true,
        )
        const alert = send(send(classNamed('NSAlert'), 'alloc'), 'init')
        sendTyped(alert, 'setAlertStyle:', [FFIType.u64], FFIType.void, WARNING)
        send(alert, 'setMessageText:', string(headline))
        send(alert, 'setInformativeText:', string(body))
        if (icon !== undefined && icon.length > 0) {
            const data = sendTyped(
                classNamed('NSData'),
                'dataWithBytes:length:',
                [FFIType.ptr, FFIType.u64],
                FFIType.ptr,
                icon,
                icon.length,
            ) as Id
            const image = send(
                send(classNamed('NSImage'), 'alloc'),
                'initWithData:',
                data,
            )
            // An icon macOS cannot read leaves the alert its own.
            if (image !== null && image !== 0) send(alert, 'setIcon:', image)
        }
        for (const button of buttons)
            send(alert, 'addButtonWithTitle:', string(button))
        const pressed = sendTyped(alert, 'runModal', [], FFIType.i64) as
            number | bigint
        return Number(pressed) - FIRST_BUTTON
    } finally {
        runtime.close()
    }
}
