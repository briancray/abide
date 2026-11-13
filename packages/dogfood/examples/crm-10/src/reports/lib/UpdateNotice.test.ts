import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import UpdateNotice from './UpdateNotice.abide'

// What the native app's window does once it has staged an update.
const staged = (detail: unknown): void => {
    window.dispatchEvent(new CustomEvent('abide:update', { detail }))
    flushSync()
}

test('an update waits for quit, and a required one for nothing', async () => {
    using _notice = await mount(UpdateNotice({}))
    expect(document.querySelector('.status, dialog')).toBeNull()
    staged({ version: '1.4.0', required: false, notes: undefined })
    expect(document.querySelector('.status')?.textContent).toContain(
        'CRM 1.4.0 installs when you quit.',
    )
    staged({ version: '1.4.1', required: true, notes: 'Fixes the export.' })
    const dialog = document.querySelector('dialog')
    expect(dialog?.textContent).toContain('CRM 1.4.1 has to be installed')
    expect(dialog?.textContent).toContain('Fixes the export.')
    const escape = new Event('cancel', { cancelable: true })
    dialog?.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    staged(null)
    expect(document.querySelector('.status, dialog')).toBeNull()
})
