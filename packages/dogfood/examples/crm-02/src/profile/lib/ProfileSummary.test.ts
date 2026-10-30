import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'

import ProfileSummary from './ProfileSummary.abide'

const shown = () =>
    [...document.querySelectorAll('strong')].map((one) => one.textContent)

function type(index: number, text: string) {
    const field = document.querySelectorAll('input')[index] as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input'))
    flushSync()
}

test('each derived value follows the fields it read', async () => {
    using _summary = await mount(ProfileSummary({}))
    expect(shown()).toEqual(['AL', '1 of 2 filled in'])
    type(0, 'Grace Hopper')
    type(1, '4155550132')
    expect(shown()).toEqual(['GH', '2 of 2 filled in'])
})

test('a phone edit reruns the count, not the initials', async () => {
    using _summary = await mount(ProfileSummary({}))
    const work = measure(() => type(1, '4155550132'))
    // The write's walk; `initials` reading the phone would make it 6.
    expect(work.descents).toBe(4)
})
