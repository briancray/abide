// The snippet mechanism's whole value is that a sample cannot drift from the file it
// claims to come from, so what is asserted here is the SLICE and the REFUSALS — the
// output of a wrong slice is still valid-looking code, which is why the errors matter
// more than the happy path.

import { expect, test } from 'bun:test'
import {
    checkFixtures,
    checkRequests,
    fixturesOf,
    FRAME_RULES,
    readExample,
    relates,
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

const FIXTURES = [
    { name: 'getCustomer', tail: 'getcustomer', args: '[["id","42"]]' },
    { name: 'getRate', tail: 'getrate', args: '[["pair","USDEUR"]]' },
] as Parameters<typeof checkFixtures>[1]

test('two fixtures a request cannot be told apart are refused', () => {
    expect(() => checkFixtures('x', FIXTURES)).not.toThrow()

    // The dangerous pair is same args, relating names: `/api/customer?id=42` would match both
    // and the shim would serve whichever came first, with the render plausible either way.
    const ambiguous = structuredClone(FIXTURES)
    ambiguous[1]!.args = '[["id","42"]]'
    ambiguous[1]!.tail = 'customer'
    expect(() => checkFixtures('x', ambiguous)).toThrow(/tells them apart/)

    // Same args and unrelated names is fine — the address separates them.
    const distinct = structuredClone(FIXTURES)
    distinct[1]!.args = '[["id","42"]]'
    expect(() => checkFixtures('x', distinct)).not.toThrow()
})

// THE ARM ASKING FOR SOMETHING THE WIRE NEVER DOCUMENTED used to be a runtime tip, seen only
// by a reader who opened the page — and three examples shipped broken behind it: two whose feed
// address no fixture answered, one that opened a WebSocket the frame does not shim at all. Both
// are refused at build now for the literal case, so what is asserted is the REFUSALS.
test('an arm that asks for something the wire cannot answer is refused', () => {
    const answers = [
        { name: 'loadOrders', tail: 'loadorders', args: '[]' },
        { name: 'logs', tail: 'logs', args: '[["stream","api"]]' },
    ] as Parameters<typeof checkRequests>[2]

    expect(() => checkRequests('x', `fetch('/api/orders')`, answers)).not.toThrow()
    expect(() => checkRequests('x', `fetch('/api/logs?stream=api')`, answers)).not.toThrow()

    // The address relates but the ARGS do not, which is the pair the shim would also miss.
    expect(() => checkRequests('x', `fetch('/api/logs')`, answers)).toThrow(/no fixture answers/)
    expect(() => checkRequests('x', `fetch('/api/drafts')`, answers)).toThrow(/no fixture answers/)

    // A COMPUTED address is the case a build genuinely cannot resolve, so it is skipped rather
    // than guessed at — the runtime tip is what covers it, and a false refusal here would make
    // an example unbuildable for an address that is fine.
    expect(() => checkRequests('x', `fetch(\`/api/\${path}\`)`, answers)).not.toThrow()

    // The silent one: no request at all, and nothing in the frame to serve it.
    expect(() => checkRequests('x', `new WebSocket('/api/logs')`, answers)).toThrow(
        /opens a WebSocket/,
    )
    expect(() => checkRequests('x', `new EventSource('/api/orders/changes')`, answers)).toThrow(
        /opens an? EventSource/,
    )
})

// The arm and the handler answer at different addresses by design, so the relation is loose on
// purpose. Both directions of containment, because neither name is reliably the longer one.
test('an address relates to a handler name either way round', () => {
    expect(relates('customer', 'getcustomer')).toBe(true)
    expect(relates('getcustomer', 'customer')).toBe(true)
    expect(relates('customer', 'getrate')).toBe(false)
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
    expect(both).toBe('const count = state(0)\n    …\n    <input bind:value={handle}>')

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

// THE ARM AND THE `.abide` SOURCE ARE CLAIMED TO BE EQUIVALENT and almost nothing checks it —
// the frame runs `vanilla/` while the Files panel shows `files/`, which is the one gap the runner
// design has. This closes the checkable corner of it: a CONTROL is markup an author wrote, so a
// button the arm renders that the page's own source never names is the two arms having come
// apart, and it renders perfectly either way.
//
// Data is legitimately absent from source, coming from a database the example stubs, so only
// controls are compared — and against the TEXT NODES of the templates, never whole source:
// matching a label against a whole file lets any coincidence rescue it, and `Post` on a button
// was once covered by `type Post` in a sibling `.ts` with the button renamed.
test('every control the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of new Bun.Glob(`${name}/files/**/*.abide`).scanSync({
            cwd: EXAMPLES_DIR.pathname,
            onlyFiles: true,
        })) {
            const template = await Bun.file(new URL(file, EXAMPLES_DIR)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const arm = await Bun.file(new URL(`${name}/vanilla/index.html`, EXAMPLES_DIR)).text()
        for (const control of arm.matchAll(/<(?:button|a)\b[^>]*>([^<]+)</g)) {
            const label = (control[1] ?? '').trim()
            if (!label || markup.includes(label)) continue
            strays.push(`${name}/vanilla/index.html: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// THE SIBLING OF THE CONTROL CHECK, pointed at the thing a demo card is FOR. A card claims
// something about work — derivations re-run, requests made, entries held — and the claim is
// only ever visible as a readout, so an arm reporting a count the `.abide` source never names
// is the two arms having come apart on the one line the reader is there to read. It renders
// perfectly either way, and it is worse than a stray button: a stray button does nothing, and
// a stray counter is a number a reader will believe. RULEBOOK 40.26.
//
// A READOUT IS A `<strong>` and its label is the text in front of it, which is the shape both
// arms already wrote — the value is the part that legitimately differs, being live in one and
// an id in the other, so only the label is compared.
//
// WHITESPACE-COLLAPSED, because HTML collapses it: the `.abide` file wraps at the 76-column
// rule the panel renders in and the arm does not, so a label reading identically on screen was
// two strings apart. Comparing the source text would have made the gate a line-wrap check.
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

// TWO SHAPES, because a card has two kinds of readout: a stat TILE, where the label is the
// `<span>` that opens the item, and an INLINE one, where it is the run of text in front of the
// value. Both are compared; a label that lived only in the arm is the drift this is here for.
//
// A TILE IS MATCHED PER ITEM rather than by what sits between the label and the value, because
// a CONTROL can sit there: the quantity stepper puts two buttons inside the tile, and a pattern
// wanting the two adjacent went blind on exactly the tile that grew one. Tiles are removed as
// they are read, so the inline pass cannot report a tile's own text a second time.
function labelsIn(markup: string): string[] {
    const labels: string[] = []
    const rest = markup.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/g, (whole, inner: string) => {
        if (!/<strong\b/.test(inner)) return whole
        labels.push(collapse(/<span[^>]*>([^<]*)<\/span>/.exec(inner)?.[1] ?? ''))
        return ''
    })
    for (const inline of rest.matchAll(/>([^<>]+)<strong\b/g)) {
        labels.push(collapse(inline[1] ?? ''))
    }
    return labels
}

test('every readout the arm renders is one the page source names', async () => {
    const strays: string[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        let markup = ''
        for (const file of new Bun.Glob(`${name}/files/**/*.abide`).scanSync({
            cwd: EXAMPLES_DIR.pathname,
            onlyFiles: true,
        })) {
            const template = await Bun.file(new URL(file, EXAMPLES_DIR)).text()
            markup += template.replaceAll(/<[^>]*>/g, '\n')
        }
        const flat = collapse(markup)
        const arm = await Bun.file(new URL(`${name}/vanilla/index.html`, EXAMPLES_DIR)).text()
        for (const label of labelsIn(arm)) {
            if (!label || flat.includes(label)) continue
            strays.push(`${name}/vanilla/index.html: "${label}"`)
        }
    }
    expect(strays).toEqual([])
})

// A COUNTED FIELD COUNTS PER EXCHANGE. The request meter aggregates by handler name, so one
// handler asked for two ids is one row and should be — but a count that belongs to a RECORD is
// that record's, and keying the substitution by handler made opening one contact raise the
// number on another. Caught before it shipped, and this is what keeps it caught.
test('two exchanges of one handler are counted apart', async () => {
    const clashing: string[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        const manifest = await Bun.file(new URL(path, EXAMPLES_DIR)).json()
        const keys = new Set<string>()
        for (const fixture of fixturesOf(manifest.wire ?? [])) {
            if (keys.has(fixture.key)) clashing.push(`${name}: ${fixture.key}`)
            keys.add(fixture.key)
        }
    }
    expect(clashing).toEqual([])
})

// A PAGE'S OWN SWITCHER IS `.switch`, and the arm is the thing that RENDERS — so an arm whose nav
// omits the class draws two default links where the `.abide` file beside it declares segmented
// tabs, and the two arms disagree on screen about markup they agree on in the download. Both
// halves are load-bearing and both regressed separately: `caching` and `rooms` carried the current
// link and not the class, `reloading` carried the class and never marked a link, and a switcher
// with nothing current is two identical pills that cannot say which page you are on.
test('a switcher in an arm is a `.switch` with exactly one link current', async () => {
    const wrong: string[] = []
    for (const path of new Bun.Glob('*/vanilla/index.html').scanSync({
        cwd: EXAMPLES_DIR.pathname,
    })) {
        const arm = await Bun.file(new URL(path, EXAMPLES_DIR)).text()
        for (const nav of arm.matchAll(/<nav\b([^>]*)>(.*?)<\/nav>/gs)) {
            const attributes = nav[1] ?? ''
            const body = nav[2] ?? ''
            if (!/\bclass="[^"]*\bswitch\b[^"]*"/.test(attributes))
                wrong.push(`${path}: nav is not a .switch`)
            const current = body.match(/aria-current=/g)?.length ?? 0
            if (current !== 1) wrong.push(`${path}: ${current} links are current, not 1`)
        }
    }
    expect(wrong).toEqual([])
})

// A CLASS THE BUILD EMITS AND THE STYLESHEET DOES NOT CARRY renders as unstyled text in the middle
// of a designed page, and it reports nowhere: `.ex-meter` shipped that way, the request counts
// reading as a stray paragraph under the frame. The sibling of "every rule the result frame lifts
// still resolves", pointed the other way — that one asks whether a rule the frame WANTS exists,
// this asks whether a class the build WRITES does.
test('every example class the build emits resolves in the stylesheet', async () => {
    const css = await Bun.file(new URL('../src/ui/app.css', import.meta.url)).text()
    const emitted = new Set<string>()
    for (const file of [
        'renderExample.ts',
        'renderMarkdown.ts',
        'renderSnippet.ts',
        'buildDocs.ts',
    ]) {
        const source = await Bun.file(new URL(`../scripts/${file}`, import.meta.url)).text()
        for (const match of source.matchAll(/class="(ex-[a-z-]+)"/g)) emitted.add(match[1] ?? '')
    }
    expect(emitted.size).toBeGreaterThan(5)
    const unstyled: string[] = []
    // A WHOLE SELECTOR, not a substring: `.ex-meterX` contains `.ex-meter`, and the first version of
    // this check passed against exactly that rename.
    for (const name of emitted) {
        if (new RegExp(`\\.${name}(?![\\w-])`).test(css)) continue
        unstyled.push(name)
    }
    expect(unstyled).toEqual([])
})
