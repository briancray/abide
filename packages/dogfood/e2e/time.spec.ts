// 52.74, 52.78 — A `Time` IN A BROWSER: its label turns as the page's clock passes a boundary, and a
// page whose clock reads differently from the server's writes its own label as it hydrates — changed
// text, never a mismatch.
//
// THE REVERT: write the label against `Date.now()` rather than the clock — a minute on, the call still
// reads "now".
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a logged call reads now, and a minute on reads 1 minute ago — 52.74', async ({
    page,
}) => {
    await page.clock.install()
    await page.goto(underMount('components/time'), {
        waitUntil: 'networkidle',
    })
    await page.getByRole('button', { name: 'Log a call' }).click()
    const latest = page.locator('li', { hasText: 'Called' }).first()
    await expect(latest).toHaveText('Called now')
    await page.clock.fastForward(61_000)
    await expect(latest).toHaveText('Called 1 minute ago')
})

test('a page whose clock is a year on from the server writes its own label, with no mismatch — 52.78', async ({
    page,
}) => {
    const warnings: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('abide:hydrate'))
            warnings.push(message.text())
    })
    const served = await (
        await page.request.get(underMount('components/time'))
    ).text()
    const serverLabel = /Last touched <time[^>]*>([^<]*)</.exec(served)?.[1]
    // A year on always turns the label: a year more is a unit or a count more.
    await page.clock.install({ time: Date.now() + 365 * 86_400_000 })
    await page.goto(underMount('components/time'), {
        waitUntil: 'networkidle',
    })
    const label = page.locator('p', { hasText: 'Last touched' }).locator('time')
    // What `format.relative` makes of the label's time against the page's own clock (52.75's units).
    const browserLabel = await label.evaluate((time) => {
        const UNITS = [
            ['year', 31_536_000_000],
            ['month', 2_592_000_000],
            ['week', 604_800_000],
            ['day', 86_400_000],
            ['hour', 3_600_000],
            ['minute', 60_000],
        ] as const
        const written = new Intl.RelativeTimeFormat('en-US', {
            numeric: 'auto',
            style: 'narrow',
        })
        const gap = Date.parse(time.getAttribute('datetime') ?? '') - Date.now()
        for (const [unit, size] of UNITS)
            if (Math.abs(gap) >= size)
                return written.format(Math.round(gap / size), unit)
        return written.format(0, 'second')
    })
    expect(browserLabel).not.toBe(serverLabel)
    await expect(label).toHaveText(browserLabel)
    expect(warnings).toEqual([])
})
