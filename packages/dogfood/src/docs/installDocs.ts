import { config } from 'zod'

// THE DOCS APP'S OWN CLIENT CODE — the scroll spy in the rail. Imperative DOM work over nodes the
// page painted: it measures layout per scroll, which no template expresses.
//
// THE PAGE HANDS ITS OWN NODES OVER (32.9). `<aside class="toc" bind:element={installDocs}>` is
// the whole wiring: the callback is handed the element when it arrives and its `Disposer` is
// what a navigation runs — so the window listeners of the page a reader left go with that page
// rather than being watched for. It was a `MutationObserver` over the body until the compiler
// emitted the binding, which is the same thing guessed at.

// zod probes for `new Function` when it BUILDS an object schema, and the CSP refuses that eval
// (29.5). `Doc` imports this module and every page imports `Doc` ahead of its examples, so this runs
// before any example's schema module does — which is what keeps the switch out of the example source.
config({ jitless: true })

/**
 * Marks the rail link of the heading the reader has scrolled to, until `signal` aborts.
 *
 * Offsets are MEASURED ONCE — on load, on resize, and after the webfonts swap, which is itself a
 * reflow — so the scroll handler is arithmetic with no layout read in it. An IntersectionObserver
 * band was tried first and got two cases wrong: nothing was active at the top, and the last
 * sections never activated because at max scroll they never enter the band.
 */
function installScrollSpy(signal: AbortSignal) {
    // READ AT EACH MEASURE, not at install: on a page the reader navigated to, the rail's list is
    // filled after the rail itself, as the page's sections register their headings.
    let headings: Element[] = []
    let links: (Element | null)[] = []
    let offsets: number[] = []
    // Read here rather than in `update`: it is a layout read, and `update` runs per scroll
    // frame after the previous frame wrote `aria-current` — which would force the layout that
    // write invalidated, every frame of every scroll. Content height is stable between
    // `measure` calls for the same reason `offsets` are.
    let bottom = 0
    let current = -1

    function measure() {
        headings = [...document.querySelectorAll('main h2[id], main h3[id]')]
        links = headings.map((heading) =>
            document.querySelector(`.toc a[href="#${heading.id}"]`),
        )
        current = -1
        // HOISTED, and it buys reads rather than forced layouts — the forced-layout COUNT does not
        // move for this (median 9 either way). A RUN OF READS WITH NO WRITE BETWEEN THEM FORCES
        // THE LAYOUT ONCE, so ten `scrollY` reads here were nine redundant reads and never nine
        // reflows. Kept because it is less work and simpler, not because it was faster.
        const scrolled = window.scrollY
        // Pre-sized and walked rather than mapped: this walks per heading, and a `map` allocates
        // the intermediate as well as the result.
        const measured = new Array<number>(headings.length)
        for (let index = 0; index < headings.length; index += 1)
            measured[index] =
                (headings[index] as Element).getBoundingClientRect().top +
                scrolled
        offsets = measured
        // EVERY READ BEFORE THE WRITE `update` MAKES. This is the ordering that matters.
        bottom = document.documentElement.scrollHeight
        update()
    }

    function update() {
        const line = window.scrollY + 80
        let next = 0
        for (let i = 0; i < offsets.length; i += 1)
            if ((offsets[i] as number) <= line) next = i
        // At the bottom there is no room left to scroll the last heading up to the line.
        if (window.innerHeight + window.scrollY >= bottom - 2) {
            next = offsets.length - 1
        }
        if (next === current) return
        links[current]?.removeAttribute('aria-current')
        links[next]?.setAttribute('aria-current', 'true')
        current = next
    }

    let queued = false
    addEventListener(
        'scroll',
        () => {
            if (queued) return
            queued = true
            requestAnimationFrame(() => {
                queued = false
                update()
            })
        },
        { passive: true, signal },
    )
    addEventListener('resize', measure, { passive: true, signal })
    // OWED ONLY WHERE THE SWAP IS STILL TO COME. The webfont swap is a reflow and moves every
    // offset, so a measure after it is real — but on a CLIENT NAVIGATION `fonts.ready` is already
    // resolved, and this ran a second whole measure one microtask behind the first for nothing.
    if (document.fonts !== undefined && document.fonts.status !== 'loaded')
        document.fonts.ready.then(measure)
    // DEFERRED PAST THE ROUTER'S MUTATIONS BY ONE FRAME, and the reason is the opposite of what a
    // counter said. `installScrollSpy` runs from a `bind:element` callback DURING mount, so
    // measuring inline forces a layout of the whole page the router has just inserted. The forced
    // COUNT is identical either way — which is why this was tried, dropped, and then measured
    // properly: `bun run bench:share` puts `abide.mount` at 22.6% of click-to-paint with the
    // measure inline and 14.7-16.2% with it deferred, over two runs. Same number of forced
    // layouts, ~7 points of the op between them, because what costs is WHEN the layout is forced
    // and not how often.
    //
    // WHAT IT COSTS: one frame in which `offsets` is empty, immediately after a navigation that
    // has just scrolled to the top — so the spy has nothing to report yet anyway.
    requestAnimationFrame(() => {
        if (!signal.aborted) measure()
    })
}

/**
 * Installs the scroll spy for a page's rail, returning its teardown.
 *
 * 32.9's callback: the node, and the teardown for it. One `AbortController` per install, so the
 * listeners a page's rail hangs leave with that page — which is what a `Disposer` is for and what a
 * navigation runs.
 */
export function installDocs(_rail: Element): () => void {
    const installing = new AbortController()
    installScrollSpy(installing.signal)
    return () => {
        installing.abort()
    }
}
