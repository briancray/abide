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
// NSApplicationActivationPolicyProhibited: no app at all, once the question is answered.
const PROHIBITED = 2
// The icon of an app with none of its own, in place of the folder a bare executable is drawn as.
const GENERIC_ICON =
    '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
// NSAlertStyleWarning: the alert's own icon, with nothing laid over it.
const WARNING = 0

const ENCODER = new TextEncoder()
function text(value: string): Uint8Array {
    return ENCODER.encode(`${value}\0`)
}

/**
 * Shows `headline` in bold over `body`, with `icon` where it is an image macOS reads, and `buttons` —
 * the first the default, pressed by Return, and the last pressed by Escape. Answers the index of the
 * button pressed.
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
        let image: Id = null
        if (icon !== undefined && icon.length > 0) {
            const data = sendTyped(
                classNamed('NSData'),
                'dataWithBytes:length:',
                [FFIType.ptr, FFIType.u64],
                FFIType.ptr,
                icon,
                icon.length,
            ) as Id
            image = send(
                send(classNamed('NSImage'), 'alloc'),
                'initWithData:',
                data,
            )
        }
        // A site with no icon, or one macOS cannot read, is drawn as an app rather than a folder.
        if (image === null || image === 0)
            image = send(
                send(classNamed('NSImage'), 'alloc'),
                'initWithContentsOfFile:',
                string(GENERIC_ICON),
            )
        if (image !== null && image !== 0) send(alert, 'setIcon:', image)
        // Laid out as AppKit lays any alert: the first button added is the default, and where each
        // goes is AppKit's. Escape, which it gives only a button titled Cancel, is the last's.
        let last: Id = null
        for (const button of buttons)
            last = send(alert, 'addButtonWithTitle:', string(button))
        send(last, 'setKeyEquivalent:', string('\u001b'))
        const pressed = sendTyped(alert, 'runModal', [], FFIType.i64) as
            number | bigint
        // This process runs on, minding the bridge, and pumps no events from here: as an app in front
        // it would read as not responding, so it closes the alert and is no app at all.
        send(send(alert, 'window'), 'orderOut:', null)
        sendTyped(
            application,
            'setActivationPolicy:',
            [FFIType.i64],
            FFIType.bool,
            PROHIBITED,
        )
        return Number(pressed) - FIRST_BUTTON
    } finally {
        runtime.close()
    }
}
