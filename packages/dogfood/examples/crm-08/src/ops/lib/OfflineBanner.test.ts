import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import OfflineBanner from './OfflineBanner.abide'

test('the banner shows while the browser is offline, and goes', async () => {
    using _banner = await mount(OfflineBanner({}))
    expect(document.querySelector('.status')).toBeNull()
    window.dispatchEvent(new Event('offline'))
    flushSync()
    expect(document.querySelector('.status')?.textContent).toContain(
        'You are offline.',
    )
    window.dispatchEvent(new Event('online'))
    flushSync()
    expect(document.querySelector('.status')).toBeNull()
})
