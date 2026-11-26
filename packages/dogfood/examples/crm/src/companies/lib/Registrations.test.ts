import { expect, test } from 'bun:test'

import { computed } from '@abide/abide'
import { createApp } from '@abide/abide/server'

import { registrations } from './registrations.server.ts'
import { registryAsked } from './registryOrigin.server.ts'

// THE REVERT: drop `global`, and the second caller's entry is its own, with no answer to fall back
// on: its read is refused 502.
test('while the registry is down, every caller is served its last answer', async () => {
    await using app = await createApp()
    const read = () =>
        app.run(async () => {
            const entry = computed(() => registrations({ id: 'noether-group' }))
            await entry
            // Handed back inside a record: a `Reactive` is thenable, and `run` would settle it.
            return { entry }
        })
    const { entry } = await read()
    // What the hour running out does while a page reads it: ask again. The registry now answers 503, three times.
    registrations.refresh({ id: 'noether-group' })
    while (registryAsked('noether-group') < 4 || entry.busy())
        await Bun.sleep(10)
    const { entry: later } = await read()
    expect(later()).toEqual({ founded: 1906, employees: 140 })
    expect(later.error()).toMatchObject({ name: 'FetchFailed' })
})
