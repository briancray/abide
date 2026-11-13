import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import { crmDatabase } from './crmDatabase.server.ts'
import TargetLog from './TargetLog.abide'

const shown = () =>
    [...document.querySelectorAll('strong')].map((one) => one.textContent)

test('a target set is a row in the file, listed newest first', async () => {
    using _log = await mount(TargetLog({}))
    const before = shown().length
    const input = document.querySelector('input')
    if (!input) throw new Error('no target field')
    input.value = '650000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('button')?.click()
    await Bun.sleep(200)
    expect(shown()[0]).toBe('$650,000')
    expect(shown().length).toBe(before + 1)
    // Under bun test the file is a scratch one, of this test file's own.
    expect(
        crmDatabase()
            .query('SELECT target FROM targets ORDER BY id DESC LIMIT 1')
            .get(),
    ).toEqual({ target: 650_000 })
})
