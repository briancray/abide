// The snippet mechanism's whole value is that a sample cannot drift from the file it
// claims to come from, so what is asserted here is the SLICE and the REFUSALS — the
// output of a wrong slice is still valid-looking code, which is why the errors matter
// more than the happy path.

import { expect, test } from 'bun:test'
import {
    FRAME_RULES,
    type Manifest,
    checkMachine,
    readExample,
} from '../scripts/renderExample.ts'
import { ELISION, slice } from '../scripts/renderSnippet.ts'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)

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
    expect(() => slice(SOURCE, 'const gone', 'page')).toThrow(/no line starts with/)
    // Two matches means the anchor stopped identifying anything, which is the failure
    // that would otherwise pick whichever line happened to come first.
    expect(() => slice(SOURCE, 'const ', 'page')).toThrow(/matches 2 lines/)
})

// An anchor is matched against the TRIMMED line, so it is written the way the code
// reads rather than the way it is indented — and what comes back is dedented to its own
// shallowest line, since a slice from inside a block would otherwise render adrift.
test('an anchor ignores indentation, and the slice drops its margin', () => {
    expect(slice(CODE, 'const label', 'x')).toBe(`const label = \`Clicked \${count()} times\``)
    expect(slice(SOURCE, '<label>', 'x').split('\n')[1]).toBe('    Handle')
})

const MACHINE: Manifest['states'] = [
    { id: 'zero', file: 'a.html', on: { 'click [data-inc]': 'one' } },
    { id: 'one', file: 'b.html', on: { 'click [data-reset]': 'zero' } },
]

test('a machine is refused for either way it can dead-end', () => {
    expect(() => checkMachine('x', MACHINE)).not.toThrow()

    const unknown = structuredClone(MACHINE)
    unknown[0]!.on = { 'click [data-inc]': 'two' }
    expect(() => checkMachine('x', unknown)).toThrow(/names no state two/)

    const duplicate = structuredClone(MACHINE)
    duplicate[1]!.id = 'zero'
    expect(() => checkMachine('x', duplicate)).toThrow(/two states share id zero/)

    // A hold with nowhere to go is the third dead end, and the quietest: the state
    // renders, the clock starts, and the machine stops there looking finished.
    const stuck = structuredClone(MACHINE)
    stuck[0]!.hold = 500
    expect(() => checkMachine('x', stuck)).toThrow(/holds but names no state/)
    stuck[0]!.after = 'one'
    expect(() => checkMachine('x', stuck)).not.toThrow()
})

// A PANEL AN EXAMPLE HAS NO ARTIFACT FOR IS NOT RENDERED — a Logs tab on an example that
// logged nothing, or a Refused tab on one nothing rejected, is a claim about work that
// never happened. The output looks fine either way, so it is asserted rather than seen.
test('a panel appears exactly when its artifact does', async () => {
    const counter = await readExample('local-state', '../')
    const form = await readExample('form-binding', '../')

    for (const panel of ['files', 'wire']) {
        expect(counter.html).toContain(`data-panel="${panel}"`)
    }
    // The Requests panel is the rpc call the page made, not a summary of it.
    expect(counter.html).toContain('GET /__abide/rpc/users/getProfile')

    // The same renderer, an example with neither artifact.
    expect(form.html).toContain('data-panel="files"')
    expect(form.html).not.toContain('data-panel="wire"')
    expect(form.html).not.toContain('data-panel="wire"')

    // THE RENDER IS NOT A PANEL, on either of them — it sits above the tabs and stays
    // there. A `data-panel="result"` coming back means it has been filed away again.
    for (const example of [counter, form]) {
        expect(example.html).toContain('class="ex-browser"')
        expect(example.html).not.toContain('data-panel="result"')
        expect(example.html.indexOf('ex-browser')).toBeLessThan(example.html.indexOf('ex-tablist'))
    }
})

// The result frame LIFTS its rules out of the app stylesheet by the text each one starts
// with, so a rule renamed or reflowed in `app.css` is silently dropped from the frame —
// the page still renders, the example just stops looking like an abide page. Nothing
// about the output says so, which is why it is asserted here.
test('every rule the result frame lifts still resolves in the stylesheet', async () => {
    const css = await Bun.file(new URL('../src/ui/app.css', import.meta.url)).text()
    const missing = FRAME_RULES.filter((selector) => !css.includes(selector))
    expect(missing).toEqual([])
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
        "const count = state(0)\n    …\n    <input bind:value={handle}>",
    )

    // Asked for backwards, returned in file order.
    expect(slice(SOURCE, `<input${ELISION}const count`, 'x')).toBe(both)

    // Adjacent runs join with no marker, because nothing was left out.
    expect(slice(SOURCE, `const count${ELISION}const handle`, 'x')).toBe(
        "const count = state(0)\nconst handle = state('', { transform: (v) => v.trim() })",
    )

    // A bad anchor is still a bad anchor when it has company.
    expect(() => slice(SOURCE, `const count${ELISION}const gone`, 'page')).toThrow(
        /no line starts with/,
    )
})

// A RESULT STATE CAN RENDER ANYTHING, which is the one drift the snippet mechanism does not
// catch: a snippet that stops matching its file fails the build, but a state showing a
// button no file produces renders perfectly. That is a demo claiming a feature the example
// does not have — it happened three times before this existed.
//
// CONTROLS are where the rule is checkable without guessing. Data the app renders is
// legitimately absent from source (it comes from a database the example stubs), and so is
// nothing else: a `<button>` or an `<a>` is markup an author WROTE, so its label is in a
// file or it is the documentation's own control — and those live inside a `.tip`, where
// this does not look.
test('every control a result renders is one the example has a file for', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        // The TEXT NODES of the example's templates, and only those. Matching a label
        // against whole source lets any coincidence rescue it — `Post` on a button was
        // covered by `type Post` in a sibling `.ts`, and the check passed with the button
        // renamed. A control's label is markup text, so that is where it has to be found.
        let markup = ''
        for (const file of new Bun.Glob(`${name}/files/**/*.abide`).scanSync({
            cwd: EXAMPLES_DIR.pathname,
            onlyFiles: true,
        })) {
            const template = await Bun.file(new URL(file, EXAMPLES_DIR)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const manifest = await Bun.file(new URL(path, EXAMPLES_DIR)).json()
        for (const state of manifest.states as { file: string }[]) {
            const body = (await Bun.file(new URL(`${name}/${state.file}`, EXAMPLES_DIR)).text())
                // The documentation's own controls, which is where they belong.
                .replaceAll(/<p class="tip">[\s\S]*?<\/p>/g, '')
            for (const control of body.matchAll(/<(?:button|a)\b[^>]*>([^<]+)</g)) {
                const label = (control[1] ?? '').trim()
                if (!label || markup.includes(label)) continue
                strays.push(`${name}/${state.file}: "${label}"`)
            }
        }
    }
    expect(strays).toEqual([])
})
