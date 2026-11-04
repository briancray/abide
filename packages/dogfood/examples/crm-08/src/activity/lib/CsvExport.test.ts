import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'
import { mount } from '@abide/harness/abide'

import CsvExport from './CsvExport.abide'

test('the preview is the file the link downloads', async () => {
    // An app in this process, which the component's call is answered by.
    await using _app = await createApp()
    using _export = await mount(CsvExport({}))
    await Bun.sleep(900)
    expect(document.querySelector('pre')?.textContent).toStartWith(
        'date,kind,note\n2026-09-02,Call,',
    )
    expect(document.querySelector('a')?.getAttribute('href')).toEndWith(
        '/activity/exportCsv',
    )
})

test('the export is a file, written a row at a time', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/activity/exportCsv'),
    )
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const first = await reader.read()
    // The header goes out alone, before the first row is read.
    expect(new TextDecoder().decode(first.value)).toBe('date,kind,note\n')
    await reader.cancel()
})
