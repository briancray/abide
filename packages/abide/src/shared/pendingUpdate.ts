// 38.148 — THE UPDATE THE NATIVE APP'S WINDOW HAS STAGED, read by name: what a page shows an
// update ready with, and what a required one is installed through. The window tells the page over
// the channel it opens for it, `abideUpdate`, once the page asks and again whenever one is staged.
//
// `undefined` ON A SERVER AND IN A BROWSER, which have no window to stage one: the same name, inert
// where it cannot apply, the way `media` is false on a server (23.31).
//
// PURE, SO AN APP THAT NEVER NAMES `pendingUpdate` DOES NOT SHIP IT, for `online`'s reason.

import { hydrated, isHydrating } from './hydrating.ts'
import { isServer } from './isServer.ts'
import { ambient } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'

type UpdateBridge = { postMessage(message: 'ask' | 'install'): void }

/** The channel a native app's window opens to the page for its updates, or `undefined`. */
function updateBridge(): UpdateBridge | undefined {
    return (
        globalThis as {
            webkit?: { messageHandlers?: { abideUpdate?: UpdateBridge } }
        }
    ).webkit?.messageHandlers?.abideUpdate
}

/** An update the window has read, checked and unpacked, waiting for the app to restart. */
export class StagedUpdate {
    version: string
    /** Whether the feed `abide bundle --required` wrote marks it as one to install now. */
    required: boolean
    /** The text of the file `abide bundle --notes` named, or `undefined`. */
    notes: string | undefined

    constructor(update: {
        version: string
        required: boolean
        notes: string | undefined
    }) {
        this.version = update.version
        this.required = update.required
        this.notes = update.notes
    }

    /** Quits the app, puts this update in its place and opens it. 38.145. */
    install(): void {
        updateBridge()?.postMessage('install')
    }
}

/** The update the native app's window has staged, as a `Reactive`; `undefined` where none is. */
export const pendingUpdate: Reactive<StagedUpdate | undefined> =
    /* @__PURE__ */ (() => {
        if (typeof window === 'undefined')
            return ambient<StagedUpdate | undefined>(undefined)
        let told: StagedUpdate | undefined
        // A BODY, so a server render in the process a test runs reads 38.148's `undefined` (22.11).
        const value = ambient<StagedUpdate | undefined>(() =>
            isServer() || isHydrating() ? undefined : told,
        )
        window.addEventListener('abide:update', (event) => {
            const detail = (event as CustomEvent).detail
            told = detail === null ? undefined : new StagedUpdate(detail)
            // 41.32 — a page hydrating keeps the server's answer until it has hydrated.
            const landed = hydrated()
            if (landed === undefined) value.set(told)
            else void landed.then(() => value.set(told))
        })
        updateBridge()?.postMessage('ask')
        return value
    })()
