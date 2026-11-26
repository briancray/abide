import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ProbabilityFilter from './ProbabilityFilter.abide'

const listed = () =>
    [...document.querySelectorAll('li')].map((item) => item.textContent)

// `slider`'S PARTS on the filter's own markup: a group named by `label`, a track holding the span and
// two thumbs, each a slider whose keys write the bound value back. THE REVERT: drop `probability.root`
// from the filter's group, and it has no role or name.
test('the range is a group holding the track, the span and two thumbs the keys move', async () => {
    using _filter = await mount(ProbabilityFilter({}))
    const group = document.querySelector('[role=group]') as HTMLElement
    expect(group.getAttribute('aria-label')).toBe('Win probability')
    expect(
        [...group.querySelectorAll('[data-slider]')].map((part) =>
            part.getAttribute('data-slider'),
        ),
    ).toEqual(['track', 'fill', 'thumb', 'thumb'])
    expect(listed()).toEqual(['Turing seats', 'Hopper renewal'])
    const low = document.querySelector('[role=slider]') as HTMLElement
    low.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }),
    )
    flushSync()
    expect(low.getAttribute('aria-valuetext')).toBe('60%')
    expect(low.getAttribute('style')).toBe('left: 60%')
    expect(listed()).toEqual(['Hopper renewal'])
})
