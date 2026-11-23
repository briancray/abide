import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import PipelineView from './PipelineView.abide'

const radios = () => [...document.querySelectorAll<HTMLElement>('[role=radio]')]
const press = (key: string) => {
    document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}

test('the arrow keys move the view and focus together', async () => {
    using _view = await mount(PipelineView({}))
    expect(document.querySelector('ol')).not.toBeNull()
    expect(radios().map((radio) => radio.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
    ])
    ;(radios()[0] as HTMLElement).focus()
    press('ArrowRight')
    expect(document.activeElement?.textContent).toBe('Board')
    expect(radios()[1]?.getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('.tiles')).not.toBeNull()
    press('ArrowRight')
    expect(document.activeElement?.textContent).toBe('List')
    expect(document.querySelector('ol')).not.toBeNull()
})
