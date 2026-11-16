import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import DockBadge from './DockBadge.abide'

test('the Dock icon counts the open deals', async () => {
    // What the native app's window puts on the page.
    const badges: (number | undefined)[] = []
    navigator.setAppBadge = async (contents) => void badges.push(contents)
    try {
        using _badge = await mount(DockBadge({}))
        expect(badges.at(-1)).toBe(3)
        expect(document.querySelector('.status')?.textContent).toBe(
            '3 open deals on the Dock icon',
        )
    } finally {
        delete (navigator as { setAppBadge?: unknown }).setAppBadge
    }
})
