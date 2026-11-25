// 38.188-38.190 — WHAT THE NATIVE APP GIVES EVERY PAGE IT SHOWS, as the web standards have it: the
// Badging API carried to the Dock icon, `print` to the platform's print panel, and `Notification`
// to the platform's notifications. WebKit defines `print` and `Notification` in a web view and
// does nothing with either; these stand in their place.
//
// SERIALIZED, not imported: `openNativeWindow` hands its source to a `WKUserScript`, so the
// function closes over nothing and every name it reads is the page's own. `permission` is what the
// app last heard, written into the source each time it is installed.

/**
 * Posts `badge <label>`, `print`, `notify <json>`, `close <id>` and `permission` to the
 * `abidePage` handler, and hears `abide:notification` and `abide:permission` back.
 */
export function pageBridge(permission: NotificationPermission): void {
    const handler = (
        globalThis as {
            webkit?:
                | {
                      messageHandlers?:
                          | {
                                abidePage?:
                                    | { postMessage(message: string): void }
                                    | undefined
                            }
                          | undefined
                  }
                | undefined
        }
    ).webkit?.messageHandlers?.abidePage
    if (handler === undefined) return
    const define = (target: object, name: string, value: unknown): void => {
        Object.defineProperty(target, name, {
            value,
            configurable: true,
            writable: true,
        })
    }

    // `[EnforceRange] unsigned long long`: truncated, and a TypeError where it is not finite or
    // falls outside the range.
    const setAppBadge = (contents?: number): Promise<void> => {
        if (contents === undefined) {
            handler.postMessage('badge flag')
            return Promise.resolve()
        }
        const count = Math.trunc(Number(contents))
        if (
            !Number.isFinite(count) ||
            count < 0 ||
            count > Number.MAX_SAFE_INTEGER
        )
            return Promise.reject(
                new TypeError(`${contents} is not a badge count`),
            )
        handler.postMessage(count === 0 ? 'badge ' : `badge ${count}`)
        return Promise.resolve()
    }
    define(navigator, 'setAppBadge', setAppBadge)
    define(navigator, 'clearAppBadge', () => setAppBadge(0))

    define(globalThis, 'print', () => handler.postMessage('print'))

    // Each request waits for the next answer the app hears; one prompt answers them all.
    let granted: (answer: NotificationPermission) => void = () => {}
    let asked: Promise<NotificationPermission> | undefined
    const shown = new Map<string, EventTarget>()
    let made = 0
    class NativeNotification extends EventTarget {
        static get permission(): NotificationPermission {
            return permission
        }
        static requestPermission(
            callback?: (answer: NotificationPermission) => void,
        ): Promise<NotificationPermission> {
            asked ??= new Promise<NotificationPermission>((resolve) => {
                granted = resolve
                handler?.postMessage('permission')
            }).finally(() => {
                asked = undefined
            })
            if (callback !== undefined) void asked.then(callback)
            return asked
        }
        static get maxActions(): number {
            return 0
        }
        readonly title: string
        readonly body: string
        readonly tag: string
        readonly icon: string
        readonly data: unknown
        readonly silent: boolean | null
        readonly requireInteraction = false
        readonly dir: NotificationDirection
        readonly lang: string
        readonly badge = ''
        readonly id: string
        onclick: ((event: Event) => unknown) | null = null
        onshow: ((event: Event) => unknown) | null = null
        onclose: ((event: Event) => unknown) | null = null
        onerror: ((event: Event) => unknown) | null = null
        constructor(title: string, options: NotificationOptions = {}) {
            super()
            this.title = String(title)
            this.body = String(options.body ?? '')
            this.tag = String(options.tag ?? '')
            this.icon = String(options.icon ?? '')
            this.data = options.data ?? null
            this.silent = options.silent ?? null
            this.dir = options.dir ?? 'auto'
            this.lang = options.lang ?? ''
            made += 1
            // A tag names the notification it replaces (the standard's "tag"), here and on screen.
            this.id = this.tag === '' ? `${Date.now()}-${made}` : this.tag
            shown.set(this.id, this)
            queueMicrotask(() => {
                if (permission !== 'granted') {
                    this.fire('error')
                    return
                }
                handler?.postMessage(
                    `notify ${JSON.stringify({
                        id: this.id,
                        title: this.title,
                        body: this.body,
                        silent: this.silent === true,
                    })}`,
                )
                this.fire('show')
            })
        }
        close(): void {
            if (!shown.has(this.id)) return
            handler?.postMessage(`close ${this.id}`)
            this.fire('close')
        }
        fire(type: 'click' | 'show' | 'close' | 'error'): void {
            if (type === 'close' || type === 'error') shown.delete(this.id)
            const event = new Event(type, { cancelable: type === 'click' })
            // Set aside while the listeners run: a DOM whose `dispatchEvent` calls `on<type>`
            // itself would otherwise call it twice.
            const handler = this[`on${type}`]
            this[`on${type}`] = null
            this.dispatchEvent(event)
            this[`on${type}`] = handler
            void handler?.call(this, event)
        }
    }
    define(globalThis, 'Notification', NativeNotification)

    addEventListener('abide:permission', (event) => {
        permission = (event as CustomEvent<NotificationPermission>).detail
        granted(permission)
    })
    addEventListener('abide:notification', (event) => {
        const { id, type } = (
            event as CustomEvent<{ id: string; type: 'click' | 'close' }>
        ).detail
        const notification = shown.get(id) as NativeNotification | undefined
        notification?.fire(type)
        if (type === 'click') shown.delete(id)
    })
}
