import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import PipelineView from '../lib/PipelineView.abide'
import { PREFERENCES } from '../server/PREFERENCES.ts'

function chosen(): string | undefined {
    const tab = document.querySelector('[aria-selected="true"]')
    return tab?.textContent?.trim()
}

test('the view picked is the view the next visit opens on', async () => {
    {
        using _first = await mount(PipelineView({}))
        await Bun.sleep(500)
        expect(chosen()).toBe('board')
        for (const tab of document.querySelectorAll('button'))
            if (tab.textContent?.trim() === 'list') tab.click()
        flushSync()
        await Bun.sleep(100)
        expect(PREFERENCES.view).toBe('list')
    }
    // A fresh component, as a reload builds one.
    using _next = await mount(PipelineView({}))
    await Bun.sleep(500)
    expect(chosen()).toBe('list')
})
