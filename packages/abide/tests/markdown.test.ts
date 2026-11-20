// `markdown` — RULEBOOK 52.8-52.16, as a pure function. What the `Markdown` component renders as a
// stream lands, and what each chunk costs, is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { markdown } from '../src/shared/markdown/markdown.ts'
import { sectionEnd } from '../src/shared/markdown/sections.ts'
import { MODEL_ANSWERS } from './fixtures/MODEL_ANSWERS.ts'

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

// THE REVERT: write `href`'s answer as the address alone, and the link opens in this tab.
test('href may answer the address with the target and rel it opens with — 52.40', () => {
    expect(
        markdown('[the registry](https://registry.example)', {
            href: (address) => ({
                href: address,
                target: '_blank',
                rel: 'noopener',
            }),
        }),
    ).toBe(
        '<p><a href="https://registry.example" target="_blank" rel="noopener">the registry</a></p>',
    )
})

test('a reference link takes the address its definition names, in any case — 52.41', () => {
    expect(
        markdown(
            '[Brief][B] and [b] and [Quote][]\n\n[b]: https://x.co/b7\n[quote]: /q',
        ),
    ).toBe(
        '<p><a href="https://x.co/b7">Brief</a> and <a href="https://x.co/b7">b</a> and <a href="/q">Quote</a></p>',
    )
    // A label nothing defines stays as written.
    expect(markdown('[nothing][here]')).toBe('<p>[nothing][here]</p>')
    // A definition is checked against `schemes` as any address is.
    expect(markdown('[run][x]\n\n[x]: javascript:alert(1)')).toBe('<p>run</p>')
})

// THE REVERT: drop the blocks, and the chart is a code block with its source in it.
test('a fenced block the caller names is its markup, handed the source and the rest of the info — 52.42', () => {
    expect(
        markdown('```chart bar\n3, 5, 4\n```', {
            blocks: {
                chart: (source, info) =>
                    `<figure data-kind="${info}">${source.split(', ').length}</figure>`,
            },
        }),
    ).toBe('<figure data-kind="bar">3</figure>')
    // A name the caller gave no block for is code.
    expect(markdown('```toString\nx\n```', { blocks: {} })).toBe(
        '<pre><code data-language="toString">x</code></pre>',
    )
})

// THE REVERT: drop `tagAt`, and the table cell's line break and the key are text — `one&lt;br&gt;two`.
test('a few formatting tags a model writes are markup, and only with no attribute — 52.46', () => {
    expect(markdown('| a |\n| - |\n| one<br>two |')).toBe(
        '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>one<br>two</td></tr></tbody></table>',
    )
    expect(
        markdown('press <kbd>Ctrl</kbd>+C, x<sup>2</sup>, <b>**bold**</b>'),
    ).toBe(
        '<p>press <kbd>Ctrl</kbd>+C, x<sup>2</sup>, <b><strong>bold</strong></b></p>',
    )
    // An attribute, a tag not on the list, or one nothing closes on its line: text.
    expect(markdown('<b onclick="x()">a</b> <script>b</script> <kbd>c')).toBe(
        '<p>&lt;b onclick=&quot;x()&quot;&gt;a&lt;/b&gt; &lt;script&gt;b&lt;/script&gt; &lt;kbd&gt;c</p>',
    )
})

// THE REVERT: drop the `&` branch from `inline`, and `&lt;div&gt;` shows as the entity it was written as.
test('a numeric reference and a common named one are the character they name — 52.47', () => {
    expect(
        markdown('use &lt;div&gt; &copy; &#169; &#xA9; &rarr; &bogus; `&amp;`'),
    ).toBe('<p>use &lt;div&gt; © © © → &amp;bogus; <code>&amp;amp;</code></p>')
})

// THE REVERT: drop `TASK`, and each box is `[ ]` written out.
test('a list item opening with [ ] or [x] is a box, ticked or not — 52.48', () => {
    expect(markdown('- [ ] write it\n- [x] test it')).toBe(
        '<ul><li data-task="open"><input type="checkbox" disabled> write it</li><li data-task="done"><input type="checkbox" disabled checked> test it</li></ul>',
    )
})

// THE REVERT: drop `dollarMathAt` and the math fences, and `$\pi r^2$` is written out as it came.
test('math is kept as its TeX, and a price is not math — 52.49', () => {
    expect(markdown('area $\\pi r^2$ and \\(e^x\\)')).toBe(
        '<p>area <span data-math="inline">\\pi r^2</span> and <span data-math="inline">e^x</span></p>',
    )
    expect(markdown('$$\n\\int_0^1 x\\,dx\n$$')).toBe(
        '<div data-math="display">\\int_0^1 x\\,dx</div>',
    )
    expect(markdown('\\[\na^2 + b^2\n\\]')).toBe(
        '<div data-math="display">a^2 + b^2</div>',
    )
    expect(markdown('it costs $5 and $10, or $5-$10')).toBe(
        '<p>it costs $5 and $10, or $5-$10</p>',
    )
})

// AN ANSWER AS A MODEL STREAMS IT: headings, numbered steps with code, emphasis, links, a table, a
// task list, math, references and a quote — what a reader would see at every character.
const ANSWERS = [
    `## Watching a value

Use \`watch\` when a **side effect** should rerun as its inputs change:

1. Import it from \`@abide/abide\`.
2. Pass a function that reads what it depends on:
   \`\`\`ts
   watch(() => document.title = count())
   \`\`\`
3. Read the [watch docs](https://example.com/watch) for the *details*.

| Option | Meaning |
| --- | --- |
| \`immediate\` | runs once at once<br>then on change |
| \`signal\` | stops it when aborted |

- [x] import it
- [ ] call it

> **Note:** a watch reading nothing runs once &mdash; and never again.

The cost is $O(n)$ in the values read, so ~~avoid~~ keep reads small.
`,
    `Here's how:

- First, install with \`bun add @abide/abide\`
- Then press <kbd>Cmd</kbd>+<kbd>K</kbd>
  - nested **detail** here
- Finally see <https://example.com>.

$$
E = mc^2
$$

That's it &check;`,
]

// What a reader sees: the markup's text, with code and math, whose characters are their own, left out.
function seen(html: string): string {
    return html
        .replace(/<pre>[\s\S]*?<\/pre>/g, '')
        .replace(/<code>[\s\S]*?<\/code>/g, '')
        .replace(/<(span|div) data-math="\w+">[\s\S]*?<\/\1>/g, '')
        .replace(/<[^>]+>/g, '')
}

// THE REVERT: render the whole source in `render` whether or not it streams — the first answer
// renders an empty `<h2></h2>` at the prefix `##`.
test('a streamed answer never shows a mark half written, and ends as it renders whole — 52.50', () => {
    for (const answer of [...ANSWERS, ...MODEL_ANSWERS]) {
        // Whole, it shows no mark either: each one closed into what it marks.
        const whole = seen(markdown(answer))
        for (const mark of ['**', '](', '`', '| -', '|---'])
            if (whole.includes(mark))
                throw new Error(
                    `the whole answer shows ${mark}: ${whole.slice(whole.indexOf(mark) - 60, whole.indexOf(mark) + 20)}`,
                )
        for (let at = 1; at <= answer.length; at += 1) {
            const prefix = answer.slice(0, at)
            const html = markdown(prefix, { streaming: true })
            const text = seen(html)
            for (const mark of [
                '**',
                '__',
                '~~',
                '](',
                '`',
                '<kbd',
                '&mdash',
                '| -',
                '$$',
            ])
                if (text.includes(mark))
                    throw new Error(
                        `${JSON.stringify(prefix.slice(-40))} shows ${mark}: ${text.slice(-80)}`,
                    )
            for (const empty of [
                '<h2></h2>',
                '<li></li>',
                '<p></p>',
                '<blockquote></blockquote>',
            ])
                if (html.includes(empty))
                    throw new Error(
                        `${JSON.stringify(prefix.slice(-40))} renders ${empty}`,
                    )
        }
        expect(markdown(`${answer}\n`, { streaming: true })).toBe(
            markdown(answer),
        )
    }
})

// THE REVERT: drop `HOLD_REACH`'s floor, and a paragraph with a stray `*` early on shows nothing at all.
test('a stray mark holds back no more than the last stretch of a line — 52.50', () => {
    const line = `5*3 is fifteen, ${'and the sentence goes on '.repeat(10)}to its end`
    expect(seen(markdown(line, { streaming: true }))).toBe(line)
    // Within reach, an opening is held until it closes.
    expect(markdown('so **very', { streaming: true })).toBe('<p>so</p>')
    // Not streaming, nothing is held.
    expect(markdown('so **very')).toBe('<p>so **very</p>')
})
