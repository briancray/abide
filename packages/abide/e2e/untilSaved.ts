import { expect, type Page } from '@playwright/test'

/**
 * Waits until the worker has saved the page `page` is on, and each of `others` with it — and, where
 * `controlled`, until the worker controls the page too (45.3, 45.13, 45.28).
 *
 * POLLED FROM HERE: `waitForFunction` does not await a predicate that returns a promise, and a
 * promise is truthy, so an async predicate passed at once — before the worker had even activated.
 */
export async function untilSaved(
    page: Page,
    others: string[] = [],
    controlled = true,
): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(
                async ({ others, controlled }) => {
                    if (
                        controlled &&
                        navigator.serviceWorker.controller === null
                    )
                        return false
                    const saved = await caches.open('abide:saved')
                    for (const address of [location.href, ...others])
                        if (
                            (await saved.match(
                                new URL(address, location.href),
                            )) === undefined
                        )
                            return false
                    return true
                },
                { others, controlled },
            ),
        )
        .toBe(true)
}
