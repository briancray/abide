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
        // The nearest `<a href>` at or above the click, because the target is whatever text or
        // icon the author put inside the link. `closest` also reaches an SVG `<a>`, whose `href`
        // is an `SVGAnimatedString` rather than a URL, so the element type is what decides.
        const anchor = (event.target as Element | null)?.closest?.('a[href]')
        if (!(anchor instanceof HTMLAnchorElement)) return
        // WHAT THE BROWSER WOULD DO ANYWAY, left to the browser: a download, a new tab, another
        // origin, or an address this build has no route for. `go` re-checks the last of these, so
        // the only thing decided here is whether to take the click at all.
        if (anchor.hasAttribute('download')) return
        const target = anchor.getAttribute('target')
        if (target !== null && target !== '' && target !== '_self') return
        const href = anchor.getAttribute('href')
        if (href === null || href.startsWith('#')) return
        const url = new URL(anchor.href, location.href)
        if (url.origin !== location.origin) return
        if (router.match(url.pathname) === undefined) return
        event.preventDefault()
        void router.go(url)
    }

    // BACK AND FORWARD HAVE ALREADY MOVED THE ADDRESS BAR by the time this runs, so the page is
    // mounted where the bar already points and nothing is pushed for it.
    const onPop = (): void => {
        const found = router.match(location.pathname)
        if (found === undefined) {
            location.reload()
            return
        }
        void router.go(location.href, { replace: true, keepScroll: true })
    }

    document.addEventListener('click', onClick)
    addEventListener('popstate', onPop)
    return () => {
        document.removeEventListener('click', onClick)
        removeEventListener('popstate', onPop)
    }
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
