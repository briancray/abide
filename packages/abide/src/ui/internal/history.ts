// The document's address bar, as the sink `#shared/router.ts` asks for.
//
// This is the whole of the DOM half of routing, and it is here because this is the package that owns
// the DOM. `#shared` keeps the policy — only the ambient caller drives the address bar — and reaching
// a `history` from there would mean a browser's worth of `globalThis` guessing inside code the server
// loads too, plus a `location` that answers for whichever caller happened to ask.

import { MOUNT_META, useMountBase } from '#shared/internal/mount.ts'
import { type HistorySink, useHistorySink } from '#shared/router.ts'

class DocumentHistory implements HistorySink {
    href(): string | null {
        // `about:blank` — what a DOM emulator and a fresh window both report — is a document without
        // a place. Treating it as one makes the first navigation throw from inside `new URL`, with
        // nothing in the message about routing.
        const shown = location.href
        return URL.parse('/', shown)?.pathname === '/' ? shown : null
    }

    push(href: string, replace: boolean): void {
        if (replace) history.replaceState(null, '', href)
        else history.pushState(null, '', href)
    }

    toTop(): void {
        scrollTo(0, 0)
    }

    listen(go: (href: string) => void): void {
        addEventListener('popstate', () => go(location.href))
    }
}

/**
 * Where this document says the app is mounted, from the `<meta>` its shell wrote.
 *
 * The client is TOLD rather than asked to work it out: a mount is a deploy-time value, so it is not in
 * the bundle, and the alternatives all name the wrong thing eventually — `location.pathname` is the
 * page rather than the base, and the bundle's own URL is the CDN when there is one.
 *
 * Absent is the ROOT, which is both the default and the honest reading of a document that said
 * nothing. Before the sink below, because installing that is what lets a navigation happen at all.
 */
export function installMount(): void {
    if (typeof document !== 'object') return
    const declared = document.querySelector(`meta[name="${MOUNT_META}"]`)
    if (declared !== null) useMountBase(declared.getAttribute('content') ?? '')
}

/**
 * Called at import of `abide/ui`, which is the statement "there is a document" — the same statement
 * `serve()` makes on the other side. Guarded anyway, because this entry point is also what a bundler
 * pulls into a worker or a script that will never render anything.
 */
export function installHistory(): void {
    if (typeof history !== 'object' || typeof history.pushState !== 'function') return
    useHistorySink(new DocumentHistory())
}
