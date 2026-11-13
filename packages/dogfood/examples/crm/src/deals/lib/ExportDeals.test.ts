import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'
import { mount } from '@abide/harness/abide'

import ExportDeals from './ExportDeals.abide'

test('the link downloads a CSV file', async () => {
    await using app = await createApp()
    using _link = await mount(ExportDeals({}))
    const href = document.querySelector('a')?.getAttribute('href') ?? ''
    const answer = await app.fetch(
        new Request(new URL(href, 'http://crm.invalid')),
    )
    expect(answer.headers.get('content-type')).toStartWith('text/csv')
})
