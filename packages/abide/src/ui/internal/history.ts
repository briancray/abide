// The document's address bar, as the sink `$shared/router.ts` asks for.
//
// This is the whole of the DOM half of routing, and it is here because this is the package that owns
// the DOM. `$shared` keeps the policy — only the ambient caller drives the address bar — and reaching
// a `history` from there would mean a browser's worth of `globalThis` guessing inside code the server
// loads too, plus a `location` that answers for whichever caller happened to ask.

import { type HistorySink, useHistorySink } from '$shared/router.ts'

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
 * Called at import of `abide/ui`, which is the statement "there is a document" — the same statement
 * `serve()` makes on the other side. Guarded anyway, because this entry point is also what a bundler
 * pulls into a worker or a script that will never render anything.
 */
export function installHistory(): void {
    if (typeof history !== 'object' || typeof history.pushState !== 'function') return
    useHistorySink(new DocumentHistory())
}
