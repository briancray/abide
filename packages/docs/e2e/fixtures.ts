// The e2e entry point every spec imports instead of `@playwright/test`.
//
// It exists for one reason: an SSR'd abide page is VISIBLE before it is INTERACTIVE. `bootstrapApp`
// awaits the route's code-split chunk, so between `load` and hydration the server's HTML is on screen
// with no listeners attached. A spec that does `goto(...)` then `click(...)` can land its click in that
// window, and the click is simply lost — the test then fails on the result element never appearing,
// which reads as a framework bug rather than a scheduling one.
//
// Serially that window is short enough to mostly get away with. With specs running in parallel it is
// wide, and it was the dominant flake: 2–5 different tests failed per run, never the same ones twice.
// Rather than sprinkle waits through 26 spec files, the `page` fixture below wraps every navigation and
// waits for the hydration marker `bootstrapPage` stamps on the app container.

import { test as base, type Page } from '@playwright/test'

const CONTAINER = '#__abide-app'
const HYDRATED = `${CONTAINER}[data-abide-hydrated]`

// Wait until the page responds to input, not merely until it renders. A document with no abide
// container (a raw `/openapi.json`-style fetch through `goto`) is left alone.
async function waitForHydration(page: Page): Promise<void> {
    if ((await page.locator(CONTAINER).count()) === 0) return
    await page.locator(HYDRATED).waitFor({ state: 'attached', timeout: 15_000 })
}

export const test = base.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        const goto = page.goto.bind(page)
        const reload = page.reload.bind(page)
        page.goto = async (url, options) => {
            const response = await goto(url, options)
            await waitForHydration(page)
            return response
        }
        page.reload = async (options) => {
            const response = await reload(options)
            await waitForHydration(page)
            return response
        }
        await use(page)
    },
})

export { expect } from '@playwright/test'
