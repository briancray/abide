// 38.190 — THE PLATFORM'S NOTIFICATIONS, what a page's `Notification` (`pageBridge`) shows through.
//
// TWO THREADS. The center calls its delegate on the main thread, through the main queue AppKit's
// wait services, so a click is heard there with the notification it names. It answers a request
// for permission on a queue of its own, where only a scalar can be read (`blockOnce`), so the
// request is made from the launcher's thread, whose loop is awake to hear it.

import { dlopen, FFIType } from 'bun:ffi'

import {
    blockOnce,
    callBlock,
    definedClass,
    type Id,
    nsString,
    objcClass,
    send,
    sendTyped,
    stringOf,
} from './appKit.ts'

// Loaded for the classes it registers.
dlopen(
    '/System/Library/Frameworks/UserNotifications.framework/UserNotifications',
    {
        UNNotificationDefaultActionIdentifier: {
            args: [],
            returns: FFIType.void,
        },
    },
)

// UNAuthorizationOptions. BADGE too: macOS draws an app's Dock badge (38.188) only once its
// notifications are allowed with the badge among them.
const BADGE = 1
const SOUND = 2
const ALERT = 4
// UNNotificationPresentationOptions: shown while the app is in front, as a page's would be.
const PRESENT = 2 | 8 | 16

/**
 * The notification center, where the process is a `.app` — outside one the center throws rather
 * than answer.
 */
export function notificationCenter(): Id {
    const identifier = send(
        send(objcClass('NSBundle'), 'mainBundle'),
        'bundleIdentifier',
    )
    if (identifier === null) return null
    return send(
        objcClass('UNUserNotificationCenter'),
        'currentNotificationCenter',
    )
}

/** Asks the person to allow notifications, answering whether they are. On the launcher's thread. */
export function requestNotificationPermission(): Promise<boolean> {
    const center = notificationCenter()
    if (center === null) return Promise.resolve(false)
    return new Promise((answered) => {
        sendTyped(
            center,
            'requestAuthorizationWithOptions:completionHandler:',
            [FFIType.u64, FFIType.ptr],
            FFIType.void,
            BADGE | ALERT | SOUND,
            blockOnce(
                [FFIType.bool, FFIType.ptr],
                (granted: boolean) => answered(granted),
                true,
            ),
        )
    })
}

/** Shows a notification, replacing the one shown under the same `id`. */
export function showNotification(
    center: Id,
    notification: { id: string; title: string; body: string; silent: boolean },
): void {
    const content = send(objcClass('UNMutableNotificationContent'), 'new')
    send(content, 'setTitle:', nsString(notification.title))
    send(content, 'setBody:', nsString(notification.body))
    if (!notification.silent)
        send(
            content,
            'setSound:',
            send(objcClass('UNNotificationSound'), 'defaultSound'),
        )
    send(
        center,
        'addNotificationRequest:withCompletionHandler:',
        send(
            objcClass('UNNotificationRequest'),
            'requestWithIdentifier:content:trigger:',
            nsString(notification.id),
            content,
            null,
        ),
        null,
    )
}

/** Takes the notification shown under `id` away. */
export function closeNotification(center: Id, id: string): void {
    const ids = send(objcClass('NSArray'), 'arrayWithObject:', nsString(id))
    send(center, 'removeDeliveredNotificationsWithIdentifiers:', ids)
    send(center, 'removePendingNotificationRequestsWithIdentifiers:', ids)
}

/** Hears each click on a notification, by its `id`. On the main thread, before it finishes launching. */
export function hearNotifications(
    center: Id,
    clicked: (id: string) => void,
): void {
    send(
        center,
        'setDelegate:',
        send(
            definedClass('AbideNotificationDelegate', {
                'userNotificationCenter:willPresentNotification:withCompletionHandler:':
                    {
                        types: 'v@:@@@?',
                        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
                        returns: FFIType.void,
                        run: (_center: Id, _notification: Id, present: Id) =>
                            callBlock(present, [FFIType.u64], PRESENT),
                    },
                'userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:':
                    {
                        types: 'v@:@@@?',
                        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
                        returns: FFIType.void,
                        run: (_center: Id, response: Id, done: Id) => {
                            clicked(
                                stringOf(
                                    send(
                                        send(
                                            send(response, 'notification'),
                                            'request',
                                        ),
                                        'identifier',
                                    ),
                                ),
                            )
                            callBlock(done, [])
                        },
                    },
            }),
            'new',
        ),
    )
}
