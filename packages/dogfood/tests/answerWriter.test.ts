// THE ANSWER BAR'S WRITER: what Claude streams, cut into blocks the bar renders once each.

import { expect, test } from 'bun:test'

import type { AnswerPart } from '../src/ask/lib/AnswerPart.ts'
import { AnswerWriter } from '../src/ask/lib/AnswerWriter.server.ts'

const ANSWER = `Use \`watch\` for a side effect.

\`\`\`ts
watch(() => console.log(count))
\`\`\`

<show example="star"/>
<show code="src/activity/lib/QuickLog.abide" from="<script"/>

It reruns when **count** changes.`

function written(chunks: readonly string[]): AnswerPart[] {
    const writer = new AnswerWriter()
    const parts: AnswerPart[] = []
    for (const chunk of chunks) parts.push(...writer.write(chunk).parts)
    parts.push(...writer.end())
    return parts
}

test('an answer is cut into prose, code and shows, in order', () => {
    expect(written([ANSWER]).map((part) => part.kind)).toEqual([
        'html',
        'code',
        'show',
        'show',
        'html',
    ])
    const [, code, example, source] = written([ANSWER])
    expect(code).toEqual({
        kind: 'code',
        language: 'ts',
        code: 'watch(() => console.log(count))',
    })
    expect(example).toEqual({
        kind: 'show',
        show: { kind: 'example', value: 'star' },
    })
    expect(source).toEqual({
        kind: 'show',
        show: {
            kind: 'code',
            value: 'src/activity/lib/QuickLog.abide',
            from: '<script',
        },
    })
})

// THE REVERT: render the whole answer per delta and keep every part it yields; the blocks repeat.
test('streamed a character at a time, the blocks are the ones written at once', () => {
    expect(written([...ANSWER])).toEqual(written([ANSWER]))
})

test("the model's markup is text, and a script address is no link", () => {
    const [prose] = written([
        '<img src=x onerror=alert(1)> [go](javascript:alert(1))\n',
    ])
    const html = prose?.kind === 'html' ? prose.html : ''
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
})

test('a line that may yet be a show is not shown as prose while it is written', () => {
    const writer = new AnswerWriter()
    expect(writer.write('Here:\n\n<show exa').tail).toBeUndefined()
})
