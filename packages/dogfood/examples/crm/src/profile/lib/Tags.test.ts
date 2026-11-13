import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'

import Tags from './Tags.abide'

test('removing a tag removes its row and rewrites no other', async () => {
    using _tags = await mount(Tags({}))
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    expect(
        [...document.querySelectorAll('strong')].map((one) => one.textContent),
    ).toEqual(['speaker', 'mentor'])
    // Keyed by the tag: one row out, and no other row's text rewritten.
    expect(work.nodesCreated).toBe(0)
    expect(work.dataWrites).toBe(0)
})
