// What a reader keeps across a navigation that stays on the route they are on.
//
// The claim is about DOM STATE, and nothing about markup can reach it: an open `<details>`, a
// carousel's scroll offset and the focus ring are all facts about NODES, and a rebuild that produces
// byte-identical HTML destroys every one of them while every correctness assertion stays green. So
// this is a browser gate by necessity, not by preference — happy-dom has no focus in the sense that
// matters and no scrolling at all.
//
// b98e49c is what this answers. `navigate`'s `replace` and `keepScroll` had a spec written, run and
// REMOVED, because any navigation re-rendered the suite and collapsed the `<details>` the controls
// live in — the second click had nothing to hit. A same-route move is answered locally now, so the
// controls stay put.
//
// ON the routing suite deliberately, and it is the hard case rather than a convenient one: its own
// cases borrow the route table per case, which used to leave every view unresolved and this page the
// only one in the app that still refilled the whole outlet. `borrowTable` asks for its modules back
// now. If these ever fail HERE and pass elsewhere, that restore is the first place to look.

import { expect, test } from 'harness/e2e'
import { goSameRoute, openEveryDetails, ROUTING_SUITE as SUITE, settle } from './internal/drive.ts'

test('an open <details> survives a same-route navigation', async ({ page }) => {
    await page.goto(SUITE)
    await settle(page)

    const opened = await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__doc = 'same-document'
        const all = Array.from(document.querySelectorAll('details'))
        for (const one of all) {
            one.open = true
            ;(one as unknown as Record<string, unknown>).__mark = 'original'
        }
        return all.length
    })
    expect(opened, 'the suite page has no <details> to make a claim about').toBeGreaterThan(0)

    await goSameRoute(page, `${SUITE}?nav=probe`)

    const after = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('details'))
        let open = 0
        let same = 0
        for (const one of all) {
            if (one.open) open++
            if ((one as unknown as Record<string, unknown>).__mark === 'original') same++
        }
        return {
            count: all.length,
            open,
            same,
            document: ((window as unknown as Record<string, unknown>).__doc as string) ?? 'FULL PAGE LOAD',
        }
    })

    // Without this the rest says nothing: `enter` hands a URL it cannot serve to the browser, and a
    // full document load rebuilds everything for a reason that has nothing to do with the outlet.
    expect(after.document, 'the navigation fell back to a full page load').toBe('same-document')
    expect(after.count, 'the page did not render after the navigation').toBe(opened)
    expect(after.same, 'the page was rebuilt — the nodes are new ones').toBe(opened)
    expect(after.open, 'the <details> closed — a rebuild, whatever the markup says').toBe(opened)
})

test('focus survives a same-route navigation', async ({ page }) => {
    await page.goto(SUITE)
    await settle(page)

    // A focusable thing in the PAGE rather than the chrome: this half is about the page the reader is
    // on, and the chrome is what the cross-route half of the work is for.
    const focused = await page.evaluate(() => {
        const target = document.querySelector('summary') as HTMLElement | null
        if (target === null) return null
        target.setAttribute('tabindex', '0')
        target.id = 'focus-probe'
        target.focus()
        return document.activeElement?.id ?? '<none>'
    })
    test.skip(focused === null, 'no focusable node in the page to make the claim with')
    expect(focused).toBe('focus-probe')

    await goSameRoute(page, `${SUITE}?nav=focus`)

    const after = await page.evaluate(() => ({
        id: document.activeElement?.id ?? '<none>',
        onBody: document.activeElement === document.body,
    }))
    expect(after.id, 'focus was lost — the node holding it was replaced').toBe('focus-probe')
    expect(after.onBody).toBe(false)
})

test('the scroll position is the reader’s across a same-route navigation', async ({ page }) => {
    await page.goto(SUITE)
    await settle(page)

    await openEveryDetails(page)
    const before = await page.evaluate(() => {
        window.scrollTo(0, 400)
        // The PAGE's own node, not `<main>`. `<main>` is the root layout's and the chrome is preserved
        // by construction, so a mark on it would survive a full rebuild of everything inside it — a
        // gate that cannot fail. `.datatable` is drawn by the page being navigated.
        const page = document.querySelector('.datatable') ?? document.body
        ;(page as unknown as Record<string, unknown>).__mark = 'original'
        return { top: window.scrollY, height: document.documentElement.scrollHeight }
    })
    test.skip(before.top === 0, 'the page is too short to scroll — nothing to preserve')

    await goSameRoute(page, `${SUITE}?nav=keep`)

    const after = await page.evaluate(() => {
        const page = document.querySelector('.datatable') ?? document.body
        return {
            top: window.scrollY,
            height: document.documentElement.scrollHeight,
            mark: ((page as unknown as Record<string, unknown>).__mark as string) ?? 'REBUILT',
        }
    })

    // The POSITION, not the height. Height was the first thing asserted here and it is the wrong
    // quantity on this page: a suite re-runs its cases when the URL moves and appends what they
    // logged, so the document legitimately grows — 7,661 to 15,921 px with nothing rebuilt, the same
    // node still marked and all 48 `<details>` still open. b98e49c saw the height move for the OTHER
    // reason (593 to 241, a page collapsing), and the two are only told apart by the mark below.
    expect(after.mark, 'the page was rebuilt — the position was preserved by accident if at all').toBe(
        'original',
    )
    expect(after.top, 'the reader was moved').toBe(before.top)
    expect(after.height).toBeGreaterThan(0)
})

// --- across routes, which is the half that scales with the layout -------------

test('the shared chrome survives a CROSS-route navigation', async ({ page }) => {
    // Two different routes — `/docs/[callable]` and `/bench` — under this app's one root layout. The
    // server renders from depth 1 and the client puts the answer inside the layout's `<slot/>`.
    await page.goto('/docs/state')
    await settle(page)

    const marked = await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__doc = 'same-document'
        const header = document.querySelector('header')
        if (header === null) return null
        ;(header as unknown as Record<string, unknown>).__mark = 'header-original'
        const link = document.querySelector('header a[href="/bench"]') as HTMLElement | null
        if (link === null) return null
        ;(link as unknown as Record<string, unknown>).__mark = 'link-original'
        link.focus()
        return document.activeElement?.getAttribute('href') ?? '<none>'
    })
    expect(marked, 'no /bench link in the chrome to drive this with').toBe('/bench')

    await page.evaluate(() => {
        ;(document.querySelector('header a[href="/bench"]') as HTMLElement).click()
    })
    await page.waitForURL('**/bench')
    await settle(page)
    expect(new URL(page.url()).pathname).toBe('/bench')

    const after = await page.evaluate(() => {
        const header = document.querySelector('header')
        const link = document.querySelector('header a[href="/bench"]')
        return {
            document: ((window as unknown as Record<string, unknown>).__doc as string) ?? 'FULL PAGE LOAD',
            header: ((header as unknown as Record<string, unknown> | null)?.__mark as string) ?? 'REBUILT',
            link: ((link as unknown as Record<string, unknown> | null)?.__mark as string) ?? 'REBUILT',
            focused: document.activeElement?.getAttribute('href') ?? '<none>',
            // The CONTROL: the page under the chrome must be the new one, or nothing navigated.
            onBench: (document.body.textContent ?? '').includes('bench'),
        }
    })

    expect(after.document, 'the navigation fell back to a full page load').toBe('same-document')
    expect(after.onBench, 'the page did not change — nothing navigated').toBe(true)
    expect(after.header, 'the shared chrome was rebuilt across routes').toBe('header-original')
    expect(after.link, 'a node inside the shared chrome was rebuilt').toBe('link-original')
    // What a keyboard reader actually loses when the chrome is rebuilt under them.
    expect(after.focused, 'focus was lost — the link holding it was replaced').toBe('/bench')
})
