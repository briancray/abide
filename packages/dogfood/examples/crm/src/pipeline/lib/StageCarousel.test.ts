import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageCarousel from './StageCarousel.abide'

const slide = (name: string) =>
    document.querySelector(`[aria-label="${name}"]`) as HTMLElement
const centered = () =>
    document.querySelector('[data-centered]')?.getAttribute('aria-label')
const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (each) =>
            each.textContent === name ||
            each.getAttribute('aria-label') === name,
    ) as HTMLButtonElement
function click(name: string) {
    button(name).click()
    flushSync()
}

// 53.61, 53.69, 53.70 — THE CAROUSEL RESTS ON THE DEAL'S STAGE, each stage a slide named for it. THE
// REVERT: rest on the first item whatever `selected` names, and lead is centered.
test("the stages rest on the deal's own, each a slide named for its stage", async () => {
    using _stages = await mount(StageCarousel({}))
    expect(slide('Stages').getAttribute('aria-roledescription')).toBe(
        'carousel',
    )
    expect(slide('qualified').getAttribute('aria-roledescription')).toBe(
        'slide',
    )
    expect(centered()).toBe('qualified')
    expect(slide('qualified').hasAttribute('data-selected')).toBe(true)
})

// 53.67, 53.68 — THE BUTTONS STEP FROM THE CENTERED STAGE, AND RESET COMES BACK TO THE DEAL'S. THE
// REVERT: step from `selected` rather than `centered`, and the second Next lands where the first did.
test("next and previous step through the stages, and reset comes back to the deal's", async () => {
    using _stages = await mount(StageCarousel({}))
    click('Next stage')
    click('Next stage')
    expect(centered()).toBe('won')
    expect(button('Next stage').disabled).toBe(true)
    click('Back to qualified')
    expect(centered()).toBe('qualified')
    click('Previous stage')
    expect(centered()).toBe('lead')
    expect(button('Previous stage').disabled).toBe(true)
})

// 53.61, 53.63 — A NEW STAGE IS WHERE THE CAROUSEL RESTS. THE REVERT: hold `centered` apart from the
// resting item, and moving to proposal leaves qualified centered.
test('moving the deal to a stage rests the carousel on it', async () => {
    using _stages = await mount(StageCarousel({}))
    click('Move to proposal')
    expect(centered()).toBe('proposal')
    expect(slide('proposal').hasAttribute('data-selected')).toBe(true)
    expect(slide('qualified').hasAttribute('data-selected')).toBe(false)
})
