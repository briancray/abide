import type { Router } from './Router.ts'

// 30.7 IN THE TWO PLACES A READER ACTUALLY NAVIGATES FROM: a link, and the back button. Neither is
// a call to `navigate`, so a router that only answered the function would reload the document on
// every click — which is the clause's own "MUST NOT reload" failing exactly where it shows.
//
// ONE LISTENER ON THE DOCUMENT, not one per link: a page rebuilt between the listener and the
// click has different anchors, and per-link wiring is a subscription per row that the region the
// router just emptied cannot take back off.
export function listenForRoutes(router: Router): () => void {
    const onClick = (event: MouseEvent): void => {
        if (!isPlainClick(event)) return
        const url = sameOriginLink(event)
        if (url === undefined || router.match(url.pathname) === undefined)
            return
        event.preventDefault()
        void router.go(url)
    }

    // 30.14 — INTENT: a pointer over a link, a finger or button pressed on one, keyboard focus on
    // one. Each asks for the route's chunks; asking again is the module cache answering, and an
    // address with no route is `prefetch`'s to drop — its own match is the only one an intent pays.
    const onIntent = (event: Event): void => {
        const url = sameOriginLink(event)
        if (url !== undefined) router.prefetch(url.pathname)
    }

    // BACK AND FORWARD HAVE ALREADY MOVED THE ADDRESS BAR by the time this runs, so the page is
    // mounted where the bar already points and nothing is pushed for it.
    //
    // 30.20 — A STEP BETWEEN TWO FRAGMENTS OF THE STANDING PAGE — back over an in-page `#anchor` jump — is
    // no navigation at all: the page, its state and its calls stay, and nothing is asked. It is
    // decided here rather than in `go`, because the entry stepped to may carry no fragment, and a
    // `go` to the same address with none is a navigation like any other.
    const onPop = (): void => {
        const found = router.match(location.pathname)
        if (found === undefined) {
            location.reload()
            return
        }
        const stepped = { replace: true, keepScroll: true }
        if (router.shows(location))
            router.follow(new URL(location.href), stepped)
        else void router.go(location.href, stepped)
    }

    const listening = new AbortController()
    const options = { signal: listening.signal }
    document.addEventListener('click', onClick, options)
    document.addEventListener('pointerover', onIntent, options)
    document.addEventListener('pointerdown', onIntent, options)
    document.addEventListener('focusin', onIntent, options)
    addEventListener('popstate', onPop, options)
    return () => listening.abort()
}

// The address a same-origin link leads to, or `undefined` for one the browser keeps whatever the
// routes say.
function sameOriginLink(event: Event): URL | undefined {
    // The nearest `<a href>` at or above the event, because the target is whatever text or icon
    // the author put inside the link. `closest` also reaches an SVG `<a>`, whose `href` is an
    // `SVGAnimatedString` rather than a URL, so the element type is what decides.
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return undefined
    // WHAT THE BROWSER WOULD DO ANYWAY, left to the browser: a download, a new tab, another
    // origin. An address this build has no route for is the caller's to check.
    if (anchor.hasAttribute('download')) return undefined
    const target = anchor.getAttribute('target')
    if (target !== null && target !== '' && target !== '_self') return undefined
    const href = anchor.getAttribute('href')
    if (href === null || href.startsWith('#')) return undefined
    const url = new URL(anchor.href, location.href)
    if (url.origin !== location.origin) return undefined
    return url
}

// A MODIFIED CLICK IS THE READER ASKING THE BROWSER, not the app: ctrl/cmd opens a tab, shift a
// window, alt downloads. Taking those is the single most complained-about thing a client router
// does, and it is four fields.
function isPlainClick(event: MouseEvent): boolean {
    return (
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.defaultPrevented
    )
}
