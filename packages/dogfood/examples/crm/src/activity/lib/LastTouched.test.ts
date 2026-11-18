import { afterEach, expect, setSystemTime, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import LastTouched from './LastTouched.abide'

afterEach(() => setSystemTime())

const said = () =>
    [...document.querySelectorAll('strong')].map((line) =>
        line.textContent?.replace(/\s+/g, ' ').trim(),
    )

test('a touch reads how long ago it was, and a new call now', async () => {
    setSystemTime(new Date('2026-11-18T15:04:00Z'))
    using _touched = await mount(LastTouched({}))
    expect(said()).toEqual([
        'Ada Lovelace, 3 hours ago',
        'Grace Hopper, yesterday',
    ])
    expect(document.querySelector('strong')?.getAttribute('title')).toBe(
        'Nov 18, 2026, 12:04 PM',
    )
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    expect(said()).toEqual([
        'Katherine Johnson, now',
        'Ada Lovelace, 3 hours ago',
        'Grace Hopper, yesterday',
    ])
    // The new row alone: the two already there say what they said.
    atMost(work, { nodesCreated: 6, dataWrites: 1 })
})
