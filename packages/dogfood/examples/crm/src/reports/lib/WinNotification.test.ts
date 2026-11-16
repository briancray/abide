import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import WinNotification from './WinNotification.abide'

test('a win is shown once notifications are allowed', async () => {
    // What the native app's window puts on the page, the person allowing it.
    const shown: { title: string; body?: string; tag?: string }[] = []
    const before = globalThis.Notification
    globalThis.Notification = Object.assign(
        function (title: string, options: NotificationOptions) {
            shown.push({ title, ...options })
        },
        { requestPermission: async () => 'granted' as const },
    ) as unknown as typeof Notification
    try {
        using _button = await mount(WinNotification({}))
        document.querySelector('button')?.click()
        await Bun.sleep(0)
        expect(shown).toEqual([
            { title: 'Deal won', body: 'Acme Corp — $12,000', tag: 'acme' },
        ])
    } finally {
        globalThis.Notification = before
    }
})
