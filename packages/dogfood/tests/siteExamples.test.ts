// THE CARDS THE ASSISTANT OFFERS: every `<Example>` a page embeds, read off the page's source.

import { expect, test } from 'bun:test'

import { siteExamples } from '../src/ask/lib/siteExamples.server.ts'
import { allCards } from './docsPages.ts'

// THE REVERT: read only `title="…"`, and every card whose title is written `title={'…'}` reads ''
// (21 of them); end the opening tag at its first `>`, and a title holding `=>` loses its files too.
test('every card a page embeds is offered with its title and its files', async () => {
    const offered = await siteExamples()
    const cards = await allCards()
    expect(offered.map((one) => one.id).sort()).toEqual(
        cards.map((card) => card.id).sort(),
    )
    for (const one of offered) {
        expect({ id: one.id, title: one.title }).toEqual({
            id: one.id,
            title: expect.stringMatching(/\S/),
        })
        expect({ id: one.id, files: one.files.length > 0 }).toEqual({
            id: one.id,
            files: true,
        })
    }
})
