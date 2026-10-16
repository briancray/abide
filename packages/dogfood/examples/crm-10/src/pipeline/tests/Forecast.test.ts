import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Forecast from '../lib/Forecast.abide'
import { LOADS } from '../server/LOADS.ts'

function press(label: string): void {
    for (const button of document.querySelectorAll('button'))
        if (button.textContent === label) button.click()
    flushSync()
}

function shown(): string | undefined {
    return document.querySelector('strong')?.textContent ?? undefined
}

test('reload now keeps the figure up; mark stale loads nothing', async () => {
    using _forecast = await mount(Forecast({}))
    await Bun.sleep(700)
    const figure = shown()
    const before = LOADS.forecast ?? 0

    press('Reload now')
    // The figure held stays on screen while the reload is out.
    expect(document.body.textContent).toContain('reloading…')
    expect(shown()).toBe(figure)
    await Bun.sleep(700)
    expect(LOADS.forecast ?? 0).toBe(before + 1)

    press('Mark stale')
    await Bun.sleep(700)
    // Nothing reads it again, so nothing loads, and the figure stays.
    expect(LOADS.forecast ?? 0).toBe(before + 1)
    expect(shown()).toBe(figure)
})
