// 50.12 — THE NOTICES SHOWING, oldest first, which `Toasts` renders. One per request on a server, as
// every `reactive` without `global` is (11.32), and `notify` never writes it there (50.16): one
// visitor's notice cannot reach another's page by either.

import { reactive } from '../reactive/index.ts'

/** One notice showing: what it says, its tone, and the action it offers, where it offers one. */
export type Toast = {
    /** What `notify` handed back for it, and what `toasts.dismiss` takes. */
    id: number
    /** What it says, written in the `text` part. */
    text: string
    /** Written as `data-tone` on the notice. */
    tone: 'info' | 'success' | 'error'
    /** The button it offers, written in the `action` part, where it offers one. */
    action: { label: string; run: () => unknown } | undefined
    /** Written onto the notice's element, `{}` where `notify` was given none (50.41). */
    attributes: Record<string, string>
}

/** The notices showing, oldest first. */
export const list = reactive<Toast[]>([], { by: 'id' })
