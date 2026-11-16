import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'

import Wallboard from './Wallboard.abide'

test('a caller asking for nothing in particular is sent events', async () => {
    // An app in this process, which the component's call is answered by.
    await using _app = await createApp()
    using _board = await mount(Wallboard({}))
    await settled()
    expect(document.querySelector('strong')?.textContent).toStartWith(
        'text/event-stream',
    )
    expect(document.querySelector('pre')?.textContent).toContain(
        'data: {"account":"Hopper & Co","stage":"Won"}\n',
    )
})
