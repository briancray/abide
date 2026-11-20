// AN ANSWER AS THE PROMPT RENDERS IT (`AnswerText.abide`): the words Claude streams, as markdown with
// the docs' code and the live things a `show` block names (40.28, 40.29).

import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import AnswerText from './AnswerText.abide'

const ANSWER = `Use \`watch\` for a side effect.

\`\`\`ts
const doubled = count * 2
\`\`\`

\`\`\`show page="/reactive/watch"
\`\`\`

\`\`\`show nonsense
\`\`\`

It reruns when **count** changes.`

// THE REVERT: drop `show` from `AnswerText`'s blocks — the block renders as an empty code block, and
// this reads `cards: 0, missing: 0`.
test('a show block renders the live thing it names, and a code fence the docs’ code — 40.28', async () => {
    using _answer = await mount(AnswerText({ text: ANSWER }))
    const card = document.querySelector('a.shown-page')
    expect(
        `cards: ${document.querySelectorAll('a.shown-page').length}, missing: ${document.querySelectorAll('.shown-missing').length}`,
    ).toBe('cards: 1, missing: 1')
    expect(card?.querySelector('span')?.textContent).toBe('Read')
    // Highlighted as a page's code is: a keyword is a token of its own.
    expect(document.querySelector('pre code .t-key')?.textContent).toBe('const')
    expect(document.querySelector('p strong')?.textContent).toBe('count')
})

test("the model's markup is text, and a script address is no link — 40.29", async () => {
    using _answer = await mount(
        AnswerText({
            text: '<img src=x onerror=alert(1)> [go](javascript:alert(1)) [here](/reactive/watch) [there](elsewhere)\n',
        }),
    )
    expect(document.querySelector('img')).toBeNull()
    const links = [...document.querySelectorAll('a')]
    expect(links.map((link) => link.textContent)).toEqual(['here'])
})
