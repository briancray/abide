// `markdown` — RULEBOOK 52.8-52.16, as a pure function. What the `Markdown` component renders as a
// stream lands, and what each chunk costs, is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { markdown } from '../src/shared/markdown/markdown.ts'
import { sectionEnd } from '../src/shared/markdown/sections.ts'

// THE REVERT: write the text between marks as it is, and the script is markup.
test('markdown escapes every character of HTML in its source — 52.8', () => {
    expect(markdown('<script>alert(1)</script>')).toBe(
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
    expect(markdown('`<b>` and "quotes" & \'ticks\'')).toBe(
        "<p><code>&lt;b&gt;</code> and &quot;quotes&quot; &amp; 'ticks'</p>",
    )
    expect(markdown('```html\n<img src=x onerror=alert(1)>\n```')).toBe(
        '<pre><code data-language="html">&lt;img src=x onerror=alert(1)&gt;</code></pre>',
    )
    expect(markdown('[a"b](https://x.com/"onclick="alert(1))')).toBe(
        '<p><a href="https://x.com/&quot;onclick=&quot;alert(1)">a&quot;b</a></p>',
    )
})

// THE REVERT: let `allowed` answer `true`, and the script address is a link.
test('a link keeps its address only on an allowed scheme — 52.9', () => {
    expect(markdown('[deal](https://crm.example/deals/1)')).toBe(
        '<p><a href="https://crm.example/deals/1">deal</a></p>',
    )
    expect(markdown('[deal](/deals/1)')).toBe(
        '<p><a href="/deals/1">deal</a></p>',
    )
    for (const address of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        ' javascript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html,<b>x</b>',
        'vbscript:x',
    ])
        expect(markdown(`[click](<${address}>)`)).not.toContain('href')
    expect(markdown('[click](javascript:alert(1))')).toBe('<p>click</p>')
    expect(markdown('<javascript:alert(1)>')).toBe('<p>javascript:alert(1)</p>')
    expect(
        markdown('[mail](mailto:ada@crm.example)', { schemes: ['https'] }),
    ).toBe('<p>mail</p>')
    expect(markdown('[ssh](ssh://host)', { schemes: ['ssh'] })).toBe(
        '<p><a href="ssh://host">ssh</a></p>',
    )
})

test('an image is a link to it, never loaded — 52.10', () => {
    expect(markdown('![the logo](https://x.com/logo.png)')).toBe(
        '<p><a href="https://x.com/logo.png">the logo</a></p>',
    )
    expect(markdown('![tracker](javascript:x)')).toBe('<p>tracker</p>')
    expect(markdown('![x](https://x.com/a.png)')).not.toContain('<img')
})

test("a fence's language is a data-language on its code — 52.11", () => {
    expect(markdown('```ts\nconst total = 1\n```')).toBe(
        '<pre><code data-language="ts">const total = 1</code></pre>',
    )
    expect(markdown('```\nplain\n```')).toBe('<pre><code>plain</code></pre>')
})

test('markdown cut mid-stream renders what it has — 52.12', () => {
    expect(markdown('```ts\nconst open = true')).toBe(
        '<pre><code data-language="ts">const open = true</code></pre>',
    )
    expect(markdown('Call **Ada')).toBe('<p>Call **Ada</p>')
    expect(markdown('[the quote](/deals/1')).toBe('<p>[the quote](/deals/1</p>')
    expect(markdown('- legal review\n- secu')).toBe(
        '<ul><li>legal review</li><li>secu</li></ul>',
    )
})

test('href rewrites each address a link keeps — 52.13, 52.14', () => {
    const href = (address: string) =>
        address.startsWith('/')
            ? `/docs${address}`
            : address.startsWith('#')
              ? address
              : undefined
    expect(markdown('[deal](/deals/1) and [top](#top)', { href })).toBe(
        '<p><a href="/docs/deals/1">deal</a> and <a href="#top">top</a></p>',
    )
    expect(markdown('[away](https://x.com) https://x.com', { href })).toBe(
        '<p>away https://x.com</p>',
    )
})

test('inline renders one line of marks with no block around it — 52.15', () => {
    expect(
        markdown('`reactive` — **one** [value](/reactive)', { inline: true }),
    ).toBe(
        '<code>reactive</code> — <strong>one</strong> <a href="/reactive">value</a>',
    )
    expect(markdown('# not a heading', { inline: true })).toBe(
        '# not a heading',
    )
})

test('markdown renders the blocks and the inline marks — 52.16', () => {
    expect(
        markdown(
            '## Next steps\n\n1. Call **Ada**\n2. Send *the* quote\n   - with `terms`\n\n> Signed ~~Friday~~ Monday\n\n---',
            { headingLevel: 3 },
        ),
    ).toBe(
        '<h4>Next steps</h4><ol><li>Call <strong>Ada</strong></li><li>Send <em>the</em> quote<ul><li>with <code>terms</code></li></ul></li></ol><blockquote><p>Signed <del>Friday</del> Monday</p></blockquote><hr>',
    )
    expect(markdown('###### six', { headingLevel: 3 })).toBe('<h6>six</h6>')
    expect(
        markdown('| Stage | Amount |\n| --- | --: |\n| Won | $8,000 |'),
    ).toBe(
        '<table><thead><tr><th>Stage</th><th data-align="right">Amount</th></tr></thead><tbody><tr><td>Won</td><td data-align="right">$8,000</td></tr></tbody></table>',
    )
    expect(markdown('line one\nline two')).toBe('<p>line one<br>line two</p>')
    expect(markdown('see https://crm.example/deals.')).toBe(
        '<p>see <a href="https://crm.example/deals">https://crm.example/deals</a>.</p>',
    )
})

const ANSWER = `# Lovelace Ltd

Ada wants the **annual** plan. Notes:

- pricing *agreed*
- legal review

  still open

\`\`\`ts
const total = 12500

// a blank line inside a fence
\`\`\`

| Stage | Amount |
| --- | --: |
| Won | $8,000 |

> Signed Monday

Thanks.
`

// A section the stream has moved past is never rendered again, so its end has to be where the
// whole text puts it, however much of the text has arrived. THE REVERT: let a list item open a
// section, and the cut after `- pricing` closes one the whole text does not.
test('a closed section ends where it ends in the whole text — 52.18', () => {
    const whole = new Set<number>()
    for (let at = 0; at < ANSWER.length; at = sectionEnd(ANSWER, at))
        whole.add(sectionEnd(ANSWER, at))
    for (let cut = 0; cut <= ANSWER.length; cut += 1) {
        const prefix = ANSWER.slice(0, cut)
        for (let at = 0; at < prefix.length;) {
            const end = sectionEnd(prefix, at)
            if (end < prefix.length)
                expect({ cut, end, whole: whole.has(end) }).toEqual({
                    cut,
                    end,
                    whole: true,
                })
            at = end
        }
    }
    expect(whole.size).toBeGreaterThan(4)
})

// A section renders alone as it does inside the whole, so the sections joined are the whole.
test('the sections rendered one by one are the whole rendered at once — 52.17', () => {
    let joined = ''
    for (let at = 0; at < ANSWER.length;) {
        const end = sectionEnd(ANSWER, at)
        joined += markdown(ANSWER.slice(at, end))
        at = end
    }
    expect(joined).toBe(markdown(ANSWER))
})

// No clock: a scan quadratic in a line of 40,000 unmatched delimiters runs past the test's timeout.
test('unmatched delimiters render in time linear in the line', () => {
    expect(markdown('*_`['.repeat(10_000))).toStartWith('<p>')
})
