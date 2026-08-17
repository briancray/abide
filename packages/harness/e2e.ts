// The browser half of the harness: a `test` that fails when the page complains.
//
// This is the fourth entry point, and it is bun-free and abide-free for the same reason `spawn.ts` is
// separate — playwright must never reach an app bundle. What it adds over playwright's own `test` is one
// fixture, and that fixture is most of the value of driving a real browser at all:
//
//   A page that renders the right markup while logging a TypeError is a page every server-side assertion
//   passes on. `renderToString` cannot see it, `bun test` cannot see it, and a reader looking at the page
//   does not open the console. So every test here fails on a console error or an unhandled rejection
//   whether or not it asserts anything about them.
//
// What this makes possible is the half the repo has never been able to test: a case's `interact` face is
// `test.skip`ped by the headless runner, because a claim that needs a click is a claim no test can make.
// A browser can make it.
//
// Specs are named `*.e2e.ts`, NOT `*.spec.ts`, and that is load-bearing: `bun test` claims `.spec.` as
// its own, so a playwright spec named that way is picked up by the wrong runner and fails on an import
// of `@playwright/test` outside a playwright process.

import { test as base, expect, type Page } from '@playwright/test'

export { expect }
// Re-exported so a spec that factors a locator walk into a helper can name what it takes without
// reaching past this entry point for playwright's own types.
export type { Page }

/**
 * Wait until the client has adopted the page — the barrier `goto` looks like and is not.
 *
 * An abide client entry does `await ready()` before it hydrates, and that is a dynamic import of the
 * page's own chunk: it resolves AFTER the `load` event, so `page.goto()` returns, `readyState` reads
 * `complete`, and not one handler on the page is attached yet. Measured, not assumed — five arrivals
 * at `/bench` on an idle machine, all five with hydration still pending.
 *
 * What that costs a driver is not a slow page but a LOST one. Playwright's actionability checks
 * usually cover the gap by accident, so a spec that types into a server-rendered field passes on a
 * quiet machine and fails under load — and it fails in the worst way available, because hydration
 * writes the cell's value back over what was typed. The field reads `""`, the markup is still
 * perfectly correct, and nothing anywhere reports an error.
 *
 * So: before the first click or keystroke on a freshly loaded page, await this. Reading a page needs
 * nothing.
 */
export function interactive(page: Page): Promise<unknown> {
    return page.waitForFunction(() => document.documentElement.dataset.abideHydrated !== undefined)
}

/** What the page said for itself, so a test can assert about a specific complaint. */
export interface Complaints {
    warnings: string[]
    /**
     * An error this page is SUPPOSED to log, by any substring of it.
     *
     * For a page whose content is a failure — a reference example demonstrating a refused load is the
     * one that needed this. Declared rather than muted, and REQUIRED rather than permitted: the
     * teardown fails if a declared line never arrived, so this is a claim about the page and not a
     * hole in the gate. Permitting was the first shape and it was worth nothing — the page it was
     * written for stayed green with the behaviour it demonstrates reverted, which is the check
     * "A GATE IS VERIFIED BY REVERTING THE FIX" is there to force.
     */
    expected(match: string): void
    /**
     * The errors no `expected` claimed — the ONE thing to assert on.
     *
     * The raw list is deliberately not on this interface. It was, and it is a trap next to this method:
     * a test that declares an expectation and then reads the raw array is red for the very line it
     * just declared, with nothing to say why.
     */
    unexpected(): string[]
}

/**
 * `test` with the page's own console attached.
 *
 * The listeners go on BEFORE navigation, which is the whole trick: a module-scope throw happens during
 * the first evaluation, and a listener attached after `goto` has already missed it.
 */
export const test = base.extend<{ complaints: Complaints }>({
    complaints: async ({ page }, use) => {
        const allowed: string[] = []
        const errors: string[] = []
        const collected: Complaints = {
            warnings: [],
            expected(match) {
                allowed.push(match)
            },
            // Always a snapshot, never the live array — an early return for the empty `allowed` would
            // hand back `errors` itself in that case and a copy in the other, so a caller holding the
            // result would see it grow on some pages and not others.
            unexpected() {
                return errors.filter((line) => !allowed.some((match) => line.includes(match)))
            },
        }
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text())
            if (message.type() === 'warning') collected.warnings.push(message.text())
        })
        page.on('pageerror', (error) => errors.push(String(error)))

        await use(collected)

        // Asserted on the way OUT, so a test does not have to remember to ask. A page that rendered
        // exactly the right markup and threw on the way is a page every server-side assertion passes on.
        expect(collected.unexpected(), 'the page logged errors').toEqual([])

        // And the other direction: a demonstrated failure that stopped being demonstrated.
        const missing = allowed.filter((match) => !errors.some((line) => line.includes(match)))
        expect(missing, 'an error this page declared it would log never arrived').toEqual([])
    },
})
