import { isServer } from '../isServer.ts'
import { close, type CloseReason, CLOSERS } from './dismiss.ts'
import { list, type Toast } from './list.ts'

/** How a notice reads, how long it stays, and what it offers. */
export type NotifyOptions = {
    /** `'info'`, `'success'` or `'error'`, written as `data-tone` on the notice. Default `'info'`. */
    tone?: Toast['tone']
    /** Milliseconds before it takes itself down; `Infinity` keeps it until it is dismissed. Default `3000`, and `10000` for an error. */
    timeout?: number
    /** A button on the notice that takes the notice down and calls `run`: an undo, a retry, or `report({ trace }).open()` for a failed call. */
    action?: { label: string; run: () => unknown }
    /** Written onto the notice's element: a `data-` attribute an analytics tag reads, say (50.41). */
    attributes?: Record<string, string>
    /** Called once as the notice leaves, told whether its timeout, a dismissal or its action took it (50.42). */
    onclose?: (reason: CloseReason) => void
}

const TIMEOUT_MS = 3000
// An error's notice stays long enough to reach its action.
const ERROR_TIMEOUT_MS = 10_000

// A counter rather than `crypto.randomUUID`, which a page served over plain http does not have.
let lastId = 0

/** Shows a notice in the app's `Toasts`, handing back its id for `toasts.dismiss`. */
export function notify(text: string, options: NotifyOptions = {}): number {
    if (isServer())
        throw new Error(
            'toasts.notify shows a notice to a person, and a server has none to show it to. RULEBOOK 50.16.',
        )
    const tone = options.tone ?? 'info'
    lastId += 1
    const id = lastId
    list.patch((held) => {
        held.push({
            id,
            text,
            tone,
            action: options.action,
            attributes: options.attributes ?? {},
        })
    })
    if (options.onclose !== undefined) CLOSERS.set(id, options.onclose)
    const timeout =
        options.timeout ?? (tone === 'error' ? ERROR_TIMEOUT_MS : TIMEOUT_MS)
    if (timeout !== Infinity) setTimeout(() => close(id, 'timeout'), timeout)
    return id
}
