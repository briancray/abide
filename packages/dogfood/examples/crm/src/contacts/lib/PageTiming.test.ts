import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { mount } from '@abide/harness/abide'

import PageTiming from './PageTiming.abide'

// happy-dom's own hook: the card requests the page from where it is open.
const openAt = (address: string) =>
    (
        window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(address)

const tile = (at: number) =>
    Number.parseInt(document.querySelectorAll('strong')[at]?.textContent ?? '')

test('the contacts page is complete before the contacts answer', async () => {
    await using app = await createApp()
    using server = Bun.serve({
        port: 0,
        fetch: (request) => app.fetch(request),
    })
    openAt(server.url.href)
    using _timing = await mount(PageTiming({}))
    document.querySelector('button')?.click()
    await Bun.sleep(600)
    flushSync()
    expect(tile(0)).toBeLessThan(tile(1))
    openAt('http://localhost/')
})
