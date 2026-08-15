// A document of a case's OWN — which is the only substrate some claims have.
//
// Everything else the harness runs shares the page it runs on: the same realm, the same stylesheet,
// the same hydration that already happened. That is right for a claim about a component and wrong for
// a claim about a DOCUMENT — a served page adopting what a server wrote, a patch script swapping a
// deferred region in, a use case measured on a shell that ships no CSS. A frame is how a case gets
// one without a second server.
//
// BROWSER ONLY, and measured rather than assumed. Both substrates hand back a usable
// `contentDocument`, and only one of them runs the scripts inside it:
//
//   chromium    `srcdoc` and `document.write` both execute — a served document patches itself in
//   happy-dom   neither does; the markup parses and the scripts sit there as text
//
// So a case whose claim depends on the document's own scripts is a claim `bun test` cannot make, the
// way a claim needing a click is. `runHeadless` says so out loud rather than passing quietly.
//
// The counters are installed on the frame's document because chromium gives it its own realm — see
// `install` in `dom.ts`, which is keyed by prototype for exactly this.

import { install } from './dom.ts'

export interface Framed {
    /** The frame's own document. Its realm, its prototypes, its stylesheet — none of them the page's. */
    document: Document
    /** Whatever the frame's `contentWindow` is, for a case that needs to reach past the document. */
    window: Window
    /**
     * Write a whole document into it, and settle once the parser is done.
     *
     * `document.write` rather than `srcdoc`: no round trip through an attribute for bytes a server
     * already produced. What this CANNOT do is run the document's own scripts — a frame filled this
     * way inherits the host page's Content-Security-Policy, and an app that serves a nonce-based one
     * blocks every inline script in the bytes written here. Use `go` when the scripts are the claim.
     */
    write(html: string): Promise<void>
    /**
     * NAVIGATE it to a path this origin serves, and settle when the document has loaded.
     *
     * The difference from `write` is the whole reason both exist: a real response carries its own
     * headers, so the page's CSP applies to it rather than the host's, and its scripts run. That is
     * what makes a served document able to patch ITSELF in — and what says an isolated demo wants a
     * route rather than a string.
     */
    go(path: string): Promise<void>
}

/** One turn of the event loop, which is what a frame needs before it has a document at all. */
const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * A frame inside `host`, counted, or `null` when this lane cannot give a case a document.
 *
 * `null` rather than a throw: a lane without frames is not a broken case, it is a claim that belongs
 * somewhere else, and the caller is what decides how to say so.
 */
export async function framed(host: HTMLElement): Promise<Framed | null> {
    if (typeof document === 'undefined') return null

    const element = document.createElement('iframe')
    // Sized so a case that measures LAYOUT is not measuring a 300x150 default, and so a reader
    // looking at `/tests` sees the thing under test rather than a letterbox.
    element.setAttribute('width', '100%')
    element.setAttribute('height', '260')
    host.append(element)

    // A frame has no document on the tick it is appended, and how many ticks it takes is the
    // engine's business rather than a number worth hard-coding.
    for (let waited = 0; element.contentDocument?.body == null && waited < 50; waited++) await settle(10)

    const inner = element.contentDocument
    const view = element.contentWindow
    if (inner?.body == null || view === null) return null

    install(inner)

    return {
        // GETTERS, because `go` replaces the document — and in chromium the realm with it. Held as
        // plain fields, every handle would go stale on the first navigation and a case would be
        // asserting about the document it used to have.
        get document(): Document {
            return element.contentDocument as Document
        },
        get window(): Window {
            return element.contentWindow as Window
        },
        async write(html: string): Promise<void> {
            const doc = element.contentDocument as Document
            doc.open()
            doc.write(html)
            doc.close()
            // The parser is what runs the scripts, and it does not finish inside `close()`.
            for (let waited = 0; doc.readyState !== 'complete' && waited < 50; waited++) await settle(10)
            await settle(0)
            install(doc)
        },
        async go(path: string): Promise<void> {
            await new Promise<void>((done) => {
                // BOUNDED. A `load` that never arrives would hang the case, and the queue runs one at
                // a time — so a page that does not settle is every case behind it never running. The
                // caller finds an unloaded document and says so, which is a failure with a reason.
                const stop = setTimeout(finish, 10_000)
                function finish(): void {
                    clearTimeout(stop)
                    element.removeEventListener('load', finish)
                    done()
                }
                element.addEventListener('load', finish)
                element.setAttribute('src', path)
            })
            const landed = element.contentDocument
            if (landed !== null) install(landed)
            await settle(0)
        },
    }
}
