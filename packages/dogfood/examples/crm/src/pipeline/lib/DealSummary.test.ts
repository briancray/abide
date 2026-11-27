import { expect, test } from 'bun:test'

import { flushSync, reactive } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import Markdown from '#src/lib/Markdown.abide'

import { summarizeDeal } from '../summarizeDeal.server.ts'
import DealSummary from './DealSummary.abide'

const summary = () => document.querySelector('[aria-label=Summary]')

test('a summary renders as it streams in', async () => {
    using _summary = await mount(DealSummary({}))
    document.querySelector('button')?.click()
    await settled()
    expect(summary()?.querySelector('h3')?.textContent).toBe(
        'Analytical Engines renewal',
    )
    expect(summary()?.querySelectorAll('li')).toHaveLength(2)
    expect(summary()?.querySelector('td')?.textContent).toBe('Proposal')
    expect(summary()?.lastElementChild?.textContent).toBe(
        'Next: send the quote.',
    )
})

// Rendered whole per chunk instead, the last chunk creates 27 nodes.
test('a chunk renders only the section still growing', async () => {
    const chunks: string[] = []
    for await (const chunk of summarizeDeal()) chunks.push(chunk)
    const source = reactive(chunks[0] ?? '')
    using _summary = await mount(Markdown({ source }))
    const heading = document.querySelector('h3')
    let last = measure(() => {})
    for (const chunk of chunks.slice(1))
        last = measure(() => {
            source.set(source.get() + chunk)
            flushSync()
        })
    // The heading closed with the first chunk, and is the node it was then.
    expect(heading?.isConnected).toBe(true)
    // The last chunk opens a paragraph, and creates that paragraph alone, with the comments
    // marking its section's row and the branch choosing markup over a block.
    atMost(last, { nodesCreated: 8 })
})
