// The snippet mechanism's whole value is that a sample cannot drift from the file it
// claims to come from, so what is asserted here is the SLICE and the REFUSALS — the
// output of a wrong slice is still valid-looking code, which is why the errors matter
// more than the happy path.

import { expect, test } from 'bun:test'
import { readExample } from '../scripts/renderExample.ts'
import { ELISION, slice } from '../scripts/renderSnippet.ts'

const SOURCE = `<script>
import { state } from 'abide'

const count = state(0)
const handle = state('', { transform: (v) => v.trim() })
</script>

<label>
    Handle
    <input bind:value={handle}>
</label>
<p>Saved</p>
`

const CODE = `export function describe(): string {
    // a brace in a comment: }
    const label = \`Clicked \${count()} times\`
    return label
}

export const after = 1
`

test('an anchor slices one construct, whatever kind it is', () => {
    expect(slice(SOURCE, 'const count', 'x')).toBe('const count = state(0)')
    // The arrow's body closes on the same line, so the slice stops there rather than
    // running to the end of the enclosing `<script>`.
    expect(slice(SOURCE, 'const handle', 'x')).toBe(
        "const handle = state('', { transform: (v) => v.trim() })",
    )
    // A tag slice takes its children; a VOID one takes only itself.
    expect(slice(SOURCE, '<label>', 'x')).toBe(
        '<label>\n    Handle\n    <input bind:value={handle}>\n</label>',
    )
    expect(slice(SOURCE, '<input', 'x')).toBe('<input bind:value={handle}>')
    expect(slice(SOURCE, '<script>', 'x')).toContain('</script>')
})

// The two things a naive bracket count gets wrong: a brace inside a comment, and a
// template literal's `${…}` — which nests, so it cannot be skipped wholesale.
test('a brace in a comment or a template literal does not close the slice', () => {
    const sliced = slice(CODE, 'export function describe', 'x')
    expect(sliced).toContain('return label')
    expect(sliced.endsWith('}')).toBe(true)
    expect(sliced).not.toContain('export const after')
})

test('an anchor that is not exactly one line is refused', () => {
    expect(() => slice(SOURCE, 'const gone', 'page')).toThrow(
        /no line starts with/,
    )
    // Two matches means the anchor stopped identifying anything, which is the failure
    // that would otherwise pick whichever line happened to come first.
    expect(() => slice(SOURCE, 'const ', 'page')).toThrow(/matches 2 lines/)
})

// An anchor is matched against the TRIMMED line, so it is written the way the code
// reads rather than the way it is indented — and what comes back is dedented to its own
// shallowest line, since a slice from inside a block would otherwise render adrift.
test('an anchor ignores indentation, and the slice drops its margin', () => {
    expect(slice(CODE, 'const label', 'x')).toBe(
        `const label = \`Clicked \${count()} times\``,
    )
    expect(slice(SOURCE, '<label>', 'x').split('\n')[1]).toBe('    Handle')
})

// THE RENDER IS NOT A FILE (40.5): the card's component sits above the file tabs and stays
// there, and the slot the page swaps it into is inside the card.
test('the card puts its component above its files', async () => {
    const card = await readExample('bind-text')
    expect(card.html.indexOf('<!--render:bind-text-->')).toBeGreaterThan(-1)
    expect(card.html.indexOf('<!--render:bind-text-->')).toBeLessThan(
        card.html.indexOf('ex-files'),
    )
    expect(card.component).toBe('BindTextContact')
})

// Several anchors are one fence, in FILE order whatever order they were asked for, and a
// gap between them is marked. Silently closing a gap would print a file that does not
// exist — two lines shown adjacent that are forty apart.
test('several anchors join into one slice, and a gap is shown', () => {
    // Relative indentation is the FILE's, kept — the `<input>` is nested inside a label
    // forty lines down, and re-indenting it flat would print a file that does not exist.
    // The elision marker takes the indent of the run it introduces.
    const both = slice(SOURCE, `const count${ELISION}<input`, 'x')
    expect(both).toBe(
        'const count = state(0)\n    …\n    <input bind:value={handle}>',
    )

    // Asked for backwards, returned in file order.
    expect(slice(SOURCE, `<input${ELISION}const count`, 'x')).toBe(both)

    // Adjacent runs join with no marker, because nothing was left out.
    expect(slice(SOURCE, `const count${ELISION}const handle`, 'x')).toBe(
        "const count = state(0)\nconst handle = state('', { transform: (v) => v.trim() })",
    )

    // A bad anchor is still a bad anchor when it has company.
    expect(() =>
        slice(SOURCE, `const count${ELISION}const gone`, 'page'),
    ).toThrow(/no line starts with/)
})

// A CLASS THE BUILD EMITS AND THE STYLESHEET DOES NOT CARRY renders as unstyled text in the middle
// of a designed page, and it reports nowhere: `.ex-meter` shipped that way, the request counts
// reading as a stray paragraph under the frame.
test('every example class the build emits resolves in the stylesheet', async () => {
    const css = await Bun.file(
        new URL('../src/ui/app.css', import.meta.url),
    ).text()
    const emitted = new Set<string>()
    for (const file of [
        'renderExample.ts',
        'renderMarkdown.ts',
        'renderSnippet.ts',
        '../src/ui/installDocs.ts',
    ]) {
        const source = await Bun.file(
            new URL(`../scripts/${file}`, import.meta.url),
        ).text()
        for (const match of source.matchAll(/class="(ex-[a-z-]+)"/g))
            emitted.add(match[1] ?? '')
    }
    expect(emitted.size).toBeGreaterThan(3)
    const unstyled: string[] = []
    // A WHOLE SELECTOR, not a substring: `.ex-meterX` contains `.ex-meter`, and the first version of
    // this check passed against exactly that rename.
    for (const name of emitted) {
        if (new RegExp(`\\.${name}(?![\\w-])`).test(css)) continue
        unstyled.push(name)
    }
    expect(unstyled).toEqual([])
})
