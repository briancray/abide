// The browser half of the kit: a `test` that fails when the page complains.
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

import { expect, test as base } from '@playwright/test'

export { expect }

/** What the page said for itself, so a test can assert about a specific complaint. */
export interface Complaints {
    errors: string[]
    warnings: string[]
}

/**
 * `test` with the page's own console attached.
 *
 * The listeners go on BEFORE navigation, which is the whole trick: a module-scope throw happens during
 * the first evaluation, and a listener attached after `goto` has already missed it.
 */
export const test = base.extend<{ complaints: Complaints }>({
    complaints: async ({ page }, use) => {
        const collected: Complaints = { errors: [], warnings: [] }
        page.on('console', (message) => {
            if (message.type() === 'error') collected.errors.push(message.text())
            if (message.type() === 'warning') collected.warnings.push(message.text())
        })
        page.on('pageerror', (error) => collected.errors.push(String(error)))

        await use(collected)

        // Asserted on the way OUT, so a test does not have to remember to ask. A page that rendered
        // exactly the right markup and threw on the way is a page every server-side assertion passes on.
        expect(collected.errors, 'the page logged errors').toEqual([])
    },
})
