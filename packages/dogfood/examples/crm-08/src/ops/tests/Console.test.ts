import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { mount } from '@abide/harness/abide'
import manifest from '../../../package.json' with { type: 'json' }
import Console from '../lib/Console.abide'

test('DEBUG writes the billing line and not the poll', async () => {
    // Booting resolves the app's name, which every namespace starts with.
    await using _app = await createApp()
    using _console = await mount(Console({}))
    for (const button of document.querySelectorAll('button')) button.click()
    flushSync()
    const namespaces = [...document.querySelectorAll('li span')].map(
        (namespace) => namespace.textContent,
    )
    // The app is named by its package; `.env`'s `DEBUG` names its line.
    expect(namespaces).toEqual([`${manifest.name}:billing`])
})
