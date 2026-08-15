// What the three navigation specs drive the page WITH.
//
// Not in `harness/e2e`: the harness's browser entry point is app-free by design, and every call below
// knows something about this app — that its controls live in a `<details>`, that `#nav-push` is one
// of them, that `/tests/[suite]/[...rest]` is the route the same-route moves stay on. A helper that
// names this app's ids belongs beside this app's specs.
//
// `.ts` and not `.e2e.ts` deliberately: playwright collects `*.e2e.ts`, so a spec-shaped name here
// would be run as a suite with no tests in it.

import type { Page } from '@playwright/test'
import { expect, interactive } from 'harness/e2e'

/** ONE route — `/tests/[suite]/[...rest]` — so every move under it stays on it. */
export const ROUTING_SUITE = '/tests/routing'

/**
 * The page has stopped fetching.
 *
 * `networkidle` and not a DOM condition, because a suite page RUNS its cases when the URL moves and
 * the cases themselves fetch — so the thing that settles last is the network rather than any node a
 * caller could name.
 */
export function settle(page: Page): Promise<void> {
    return page.waitForLoadState('networkidle')
}

/**
 * Open the suite page and every `<details>` on it, then wait for a control to be clickable.
 *
 * The controls live inside a `<details>`, and a shut one has nothing clickable in it — so this is a
 * precondition of every claim below rather than a convenience. Waiting on `#nav-push` rather than on
 * a span of time is what makes it a wait and not a guess.
 */
export async function openControls(page: Page, suite: string = ROUTING_SUITE): Promise<void> {
    await page.goto(suite)
    // Before the first click, never after: `goto` is not the barrier it looks like. See `interactive`.
    await interactive(page)
    await settle(page)
    await openEveryDetails(page)
    await page.locator('#nav-push').waitFor({ state: 'visible' })
}

/** Every `<details>` on the page, opened. Returns how many there were, so a caller can assert on it. */
export function openEveryDetails(page: Page): Promise<number> {
    return page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('details'))
        for (const one of all) one.open = true
        return all.length
    })
}

/**
 * Move without touching the chrome, so what is asserted is the navigation and not the click.
 *
 * The history event by hand rather than a click, because these callers are asserting about the page
 * they are standing on — a click would first have to find a control that survives the move, which is
 * the thing under test. `openControls` plus `clickControl` is the arm that goes through `navigate`.
 */
export async function goSameRoute(page: Page, to: string): Promise<void> {
    // The popstate listener is the client's, so this is a click in everything but the shape of it.
    await interactive(page)
    await page.evaluate((target) => {
        history.pushState(null, '', target)
        dispatchEvent(new PopStateEvent('popstate'))
    }, to)
    await page.waitForURL(`**${to}`)
    await settle(page)
}

/** Click one of the id'd controls, and wait for the address bar rather than for a span of time. */
export async function clickControl(page: Page, id: string, lands: string): Promise<void> {
    await page.locator(`#${id}`).click()
    await page.waitForURL(`**${lands}`)
    await settle(page)
    expect(new URL(page.url()).pathname).toBe(lands)
}
