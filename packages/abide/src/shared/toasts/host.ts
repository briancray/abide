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

/** The parts `toasts.host` hands back: `<div {...shown.region}>`, a notice per `shown.notices()`. */
export type ToastsHost = {
    /** The live region: its role, its politeness and its name. */
    readonly region: Record<string, unknown>
    /** The notices to render, oldest first: none where another host shows them. */
    notices(): readonly Toast[]
    /** A notice's element: the attributes `notify` was handed, and its tone as `data-tone`. */
    notice(toast: Toast): Record<string, unknown>
    /** A notice's action button, which closes the notice and runs the action. */
    action(toast: Toast): Record<string, unknown>
    /** A notice's close button. */
    close(toast: Toast): Record<string, unknown>
    /** Closes a notice and runs its action, for markup that calls it rather than spreading `action`. */
    act(toast: Toast): void
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
            'aria-live': 'polite',
            get 'aria-label'() {
                return live(options.label ?? 'Notices')
            },
        },
        notices: () => (shows() ? list() : []),
        notice: (toast) => ({ ...toast.attributes, 'data-tone': toast.tone }),
        action: (toast) => ({ type: 'button', onclick: () => act(toast) }),
        close: (toast) => ({
            type: 'button',
            'aria-label': 'Dismiss',
            onclick: () => dismiss(toast.id),
        }),
        act,
    }
}
