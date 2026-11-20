// ABIDE'S PAIRING, held to the steps a card cannot show: a connection that takes too long, and a
// visitor who goes offline. Each read of the pairing status is answered by the test.

import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import Pairing from '@abide/abide/Pairing.abide'
import { mount, settled } from '@abide/harness/abide'

const realFetch = globalThis.fetch
afterEach(() => {
    globalThis.fetch = realFetch
    window.dispatchEvent(new Event('online'))
})

const step = () => document.querySelector('section')?.getAttribute('data-step')

const UNPAIRED = {
    paired: false,
    missing: [],
    command: 'bunx @abide/bridge http://crm.invalid one',
    link: 'abide-bridge://pair?code=one',
    install: 'bunx @abide/bridge install',
}

// THE REVERT: drop the timer, and a status that never answers reads Connecting… for good.
test('a connection that takes too long offers to try again, and trying again asks again', async () => {
    let asked = 0
    let answer: (response: Response) => void = () => {}
    globalThis.fetch = (() => {
        asked += 1
        return new Promise<Response>((resolve) => {
            answer = resolve
        })
    }) as unknown as typeof fetch
    using _pairing = await mount(Pairing({ slowAfter: 20 }))
    expect(step()).toBe('connecting')
    await Bun.sleep(40)
    flushSync()
    expect(step()).toBe('slow')
    const before = asked
    ;(document.querySelector('[data-part=retry]') as HTMLButtonElement).click()
    flushSync()
    expect(asked).toBeGreaterThan(before)
    answer(Response.json(UNPAIRED))
    await settled()
    expect(step()).toBe('click')
})

// THE REVERT: drop the `offline` arm, and a visitor offline is shown the click that cannot pair.
test('a visitor offline is told so, and the step returns once they are back', async () => {
    globalThis.fetch = (async () =>
        Response.json(UNPAIRED)) as unknown as typeof fetch
    using _pairing = await mount(Pairing({}))
    await settled()
    expect(step()).toBe('click')
    window.dispatchEvent(new Event('offline'))
    flushSync()
    expect(step()).toBe('offline')
    expect(document.querySelector('[data-part=message]')?.textContent).toBe(
        'You are offline. Pairing resumes once you are back.',
    )
    window.dispatchEvent(new Event('online'))
    flushSync()
    expect(step()).toBe('click')
})
