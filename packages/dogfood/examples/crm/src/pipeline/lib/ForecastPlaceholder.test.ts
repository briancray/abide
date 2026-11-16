import { beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'

import getForecast from '../getForecast.handler.ts'
import ForecastPlaceholder from './ForecastPlaceholder.abide'

// This test is about the first load, which another test may have made.
beforeEach(() => getForecast.invalidate())

const shown = () => document.body.textContent ?? ''

test('the placeholder stands in for the first load, not a reload', async () => {
    using _forecast = await mount(ForecastPlaceholder({}))
    expect(shown()).toContain('Adding up the pipeline…')

    // The component's call is the one standing, so this waits on it.
    await getForecast()
    flushSync()
    expect(shown()).not.toContain('Adding up')
    const figure = document.querySelector('strong')?.textContent

    const reload = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    // The figure stays while the reload is out, and no placeholder is built.
    expect(reload.nodesCreated).toBe(0)
    expect(shown()).not.toContain('Adding up')
    expect(document.querySelector('strong')?.textContent).toBe(figure)
    await getForecast()
})
