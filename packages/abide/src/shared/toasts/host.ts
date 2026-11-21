// 50.17, 50.18, 50.36 — WHERE `toasts.notify` SHOWS, as parts an app spreads onto markup of its own: the
// live region every notice is read out from as it lands, and each notice's element, its action and its
// close button. Called from the script of the one component that shows the notices; of several
// standing, the last shows them and the others show none.

import { type Live, live } from '../live.ts'
import { close, dismiss } from './dismiss.ts'
import { list, notices, type Toast } from './list.ts'

/** What the region is called. */
export type ToastsHostOptions = {
    /** The region's accessible name. `'Notices'` by default; read live where a function is given. */
    label?: Live<string>
}

/** One notice's parts: its element, its text, its action and close buttons, and what runs its action. */
export type ToastParts = {
    /** The notice's element: the attributes `notify` was handed, and its tone as `data-tone`. */
    readonly toast: Record<string, unknown>
    /** The element holding the notice's text. */
    readonly text: Record<string, unknown>
    /** The notice's action button, which closes the notice and runs the action. */
    readonly action: Record<string, unknown>
    /** The notice's close button. */
    readonly close: Record<string, unknown>
    /** Closes the notice and runs its action, for markup that calls it rather than spreading `action`. */
    act(): void
}

/** The parts `toasts.host` hands back: `<div {...shown.region}>`, a notice per `shown.notices`. */
export type ToastsHost = {
    /** The live region: its role, its politeness and its name. */
    readonly region: Record<string, unknown>
    /** The notices to render, oldest first: none where another host shows them. */
    get notices(): readonly Toast[]
    /** One notice's parts. */
    toast(toast: Toast): ToastParts
}

/** The live region `toasts.notify` shows in, as parts to spread. */
export function host(options: ToastsHostOptions = {}): ToastsHost {
    // 50.36 — this host, among the ones standing; the last renders the notices.
    const shows = notices.stand()
    const act = (toast: Toast): void => {
        close(toast.id, 'action')
        toast.action?.run()
    }
    return {
        region: {
            role: 'status',
            'data-part': 'region',
            'aria-live': 'polite',
            get 'aria-label'() {
                return live(options.label ?? 'Notices')
            },
        },
        get notices() {
            return shows() ? list() : []
        },
        toast: (toast) => ({
            toast: {
                ...toast.attributes,
                'data-part': 'toast',
                'data-tone': toast.tone,
            },
            text: { 'data-part': 'text' },
            action: {
                type: 'button',
                'data-part': 'action',
                onclick: () => act(toast),
            },
            close: {
                type: 'button',
                'data-part': 'close',
                'aria-label': 'Dismiss',
                onclick: () => dismiss(toast.id),
            },
            act: () => act(toast),
        }),
    }
}
