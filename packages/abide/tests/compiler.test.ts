import { afterAll, expect, test } from 'bun:test'
import { compileFile, parseAbide } from '#compiler'
import { escapeText, render } from '#server'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAGE = `<head>
    <title>{title}</title>
</head>

<script>
const title = 'abide'
const danger = '<img src=x onerror=alert(1)>'
</script>

<h1 class="title">{title}</h1>
<p>hello</p>
<p>{danger}</p>
`

test('a file splits into its script, its style and its template', () => {
    const file = parseAbide(
        `<script>const a = 1</script><style>p{color:red}</style><p>x</p>`,
    )
    expect(file.scripts).toEqual(['const a = 1'])
    expect(file.styles).toEqual(['p{color:red}'])
    expect(file.template).toHaveLength(1)
    expect(file.template[0]).toMatchObject({ kind: 'element', tag: 'p' })
})

test('an attribute is parsed with and without a value', () => {
    const file = parseAbide(`<input required name="n"/>`)
    expect(file.template[0]).toMatchObject({
        kind: 'element',
        tag: 'input',
        attributes: [
            { name: 'required', value: '' },
            { name: 'name', value: 'n' },
        ],
    })
})

// 33.17 — a whitespace run carrying a newline and no space or tab is dropped wherever it stands.
// 33.18 — one carrying indentation too is dropped at the ends of a body, where it is the author's
// layout rather than a space the document asked for.
test('formatting whitespace is dropped and a real space is kept', () => {
    const file = parseAbide('<p>\n<b>a</b>\n<i>b</i>\n</p>')
    const children = (file.template[0] as { children: unknown[] }).children
    expect(children).toHaveLength(2)

    const spaced = parseAbide('<p><b>a</b> <i>b</i></p>')
    const kept = (spaced.template[0] as { children: { kind: string }[] })
        .children
    expect(kept.map((c) => c.kind)).toEqual(['element', 'text', 'element'])
})

// 32.1. THE REVERT: emit `String(...)` in place of `escapeText(...)` in `emitComponent`. The
// rendered document then carries 1 live `<script>` span where 0 is due, and this test reports
// `<script>alert(1)</script>` against the escaped form. Not installable — the call is written
// into the emitted source — so the number lives here, per `harness/gate`'s own provision.
test('an expression slot is escaped', () => {
    const emitted = compileFile(
        `<script>const t = '<img src=x onerror=alert(1)>'</script><h1>{t}</h1>`,
    )
    expect(emitted).toContain('escapeText(t)')
    expect(emitted).not.toContain('String(t)')
})

test('escapeText rewrites only what a parse would read', () => {
    expect(escapeText('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escapeText('a & b')).toBe('a &amp; b')
    // The clean string is returned as it arrived — the fast path, and the common slot.
    const clean = 'nothing to do here'
    expect(escapeText(clean)).toBe(clean)
    expect(escapeText(null)).toBe('')
})

// 32.22 — a scheme outside http:, https:, mailto: or tel: is dropped. THE REVERT: return true
// from `isSafeUrl` unconditionally; the emitted markup then carries 1 `javascript:` href where 0
// is due, and this test reports it.
test('an unsafe url scheme is dropped and a relative reference is kept', () => {
    expect(compileFile(`<a href="javascript:alert(1)">x</a>`)).not.toContain(
        'javascript:',
    )
    expect(compileFile(`<a href="/docs">x</a>`)).toContain(
        JSON.stringify('<a href="/docs">'),
    )
    expect(compileFile(`<a href="https://example.com">x</a>`)).toContain(
        JSON.stringify('<a href="https://example.com">'),
    )
})

// The client bundle is the point of this stage: a static page ships no runtime. THE REVERT: emit
// an unconditional `import 'abide/runtime'` in `emitComponent`; this test then reports 1 runtime
// import where 0 is due, and the byte count of the runtime lands on every static page.
test('a static page emits no client runtime import', () => {
    const emitted = compileFile(PAGE)
    expect(emitted).not.toContain('abide/runtime')
    expect(emitted).toContain("from 'abide/server'")
    // And a page with no slot at all imports nothing: an emitted module carrying an import
    // nothing calls is a name an app's own tooling reports as unused, in a file nobody wrote.
    expect(compileFile('<h1>static</h1>')).not.toContain('import')
})

// CLAUDE.md, "seams and imports", and the comment in `src/server/index.ts`: the compiler is not
// reachable through the public server specifier.
test('the compiler is not reachable from the server seam', async () => {
    const server = await import('#server')
    expect(Object.keys(server).sort()).toEqual([
        'escapeAttribute',
        'escapeText',
        'render',
    ])
})

afterAll(removeTemporaryModules)

test('a compiled page renders as bytes into a shell', async () => {
    const module = `${temporaryModule({ 'Page.ts': compileFile(PAGE) })}/Page.ts`

    const { default: Page } = await import(module)
    const shell =
        '<!doctype html><html><head><title>t</title></head><body></body></html>'
    let out = ''
    for await (const chunk of render(Page, shell))
        out += new TextDecoder().decode(chunk)

    // 39.1, 39.3 — the head contribution is hoisted at compile time and lands in the document
    // head, not where it was written. THE REVERT: emit `<head>` into the body like any other
    // element; this test then reports the title at an index AFTER `</head>` where 1 before it is
    // due, and the browser gets a `<title>` it will relocate on parse.
    expect(out).toContain('<title>abide</title>')
    expect(out.indexOf('<title>abide</title>')).toBeLessThan(
        out.indexOf('</head>'),
    )
    // 41.10 — a body slot is wrapped in the markers the client finds it by. A HEAD slot is not:
    // nothing hydrates it, so it carries no marker and the client counts none there.
    expect(out).toContain('<h1 class="title"><!--a-->abide<!--/a--></h1>')
    expect(out).toContain('<title>abide</title>')
    // The escape is asserted on the RENDERED document, not on the emitted source: the
    // mechanism is what reaches a browser, and a grep for `escapeText(` passes against a
    // module that does not compile.
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('<p>hello</p>')
    expect(out.endsWith('</body></html>')).toBe(true)
})

// 39.2 — a nested `<head>` would render inside the body, which is the silent wrong answer.
test('a head below the top level is refused', () => {
    expect(() =>
        compileFile('<div><head><title>x</title></head></div>'),
    ).toThrow('39.2')
})
