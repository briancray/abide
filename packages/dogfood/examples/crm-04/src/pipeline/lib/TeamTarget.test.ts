import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import { crmDatabase } from './crmDatabase.server.ts'
import TeamTarget from './TeamTarget.abide'

const shown = () => document.querySelector('strong')?.textContent

test('a target set once is what every later visit opens on', async () => {
    // One scratch file per process, which another test file may have written.
    crmDatabase().run('DELETE FROM targets')
    {
        using _first = await mount(TeamTarget({}))
        await Bun.sleep(500)
        expect(shown()).toBe('$500,000')
        const input = document.querySelector('input')
        if (!input) throw new Error('no target field')
        input.value = '750000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await Bun.sleep(100)
        expect(crmDatabase().query('SELECT target FROM targets').get()).toEqual(
            {
                target: 750_000,
            },
        )
    }
    // A fresh component, as another visitor's page builds one.
    using _next = await mount(TeamTarget({}))
    await Bun.sleep(500)
    expect(shown()).toBe('$750,000')
})
