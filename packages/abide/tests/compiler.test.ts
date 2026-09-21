import { afterAll, expect, test } from 'bun:test'
import { compileFile, parseAbide } from '#compiler'
import { escapeStyleValue, escapeText, render } from '#server'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import {
    clientOf,
    closeTyped,
    namesRead,
    refusal,
    serverOf,
    typed,
} from './typed.ts'

afterAll(closeTyped)

// Which of `names` the checker found bound to a `Reactive` at the top of `script`.
const declared = async (script: string, names: string[]): Promise<string[]> => {
    const { file, reads } = await typed(
        `<script>${script}</script>${names.map((name) => `{${name}}`).join('')}`,
    )
    return namesRead(file, reads)
}

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

// 32.21 — a scheme outside http:, https:, mailto: or tel: is dropped. THE REVERT: return the
// value unconditionally from `safeUrl`; the emitted markup then carries 1 `javascript:` href where
// 0 is due, and this test reports it.
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
    // THE WHOLE ISOMORPHIC SURFACE CROSSES, so the list is the shared seam's plus what the server
    // owns: `listOf` is 32.15's — the emitted `{#for}` and the client's `updateList` ask the one
    // function what a subject iterates as — `render` is 35.4's, and the five methods are 16.2's.
    const shared = Object.keys(await import('#shared'))
    expect(Object.keys(server).sort()).toEqual(
        [
            ...shared,
            'DELETE',
            'GET',
            'PATCH',
            'POST',
            'PUT',
            'render',
            'renderComponent',
        ].sort(),
    )
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
    // NOTHING IS ADDED TO THE DOCUMENT. The markup is what the author would have written by
    // hand, and the client finds its bindings by position rather than by anything put there.
    expect(out).toContain('<h1 class="title">abide</h1>')
    expect(out).toContain('<title>abide</title>')
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('data-a')
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

// A DECLARATOR LIST BINDS MORE THAN ONE NAME. Only the first was read, so the second never
// reached the checker, never came back typed `Reactive<...>`, and lowered as WRITTEN — which
// renders the `Reactive` itself where its value was due, with nothing about the page saying so.
//
// THE REVERT: take the identifier after the keyword and stop. `b` disappears from the list below.
test('every name in a declarator list is declared', async () => {
    expect(
        await declared('let a = reactive(0), b = reactive(1)', ['a', 'b']),
    ).toEqual(['a', 'b'])
    // The comma inside an initializer is the initializer's own.
    expect(
        await declared('const a = reactive([1, 2]), b = reactive(3)', [
            'a',
            'b',
        ]),
    ).toEqual(['a', 'b'])
    // 31.12's case, not this one: a pattern binds names this does not see.
    expect(
        await declared('const { x, y } = { x: reactive(0), y: reactive(1) }', [
            'x',
            'y',
        ]),
    ).toEqual([])
    // `let` inside a string is not a declaration.
    expect(
        await declared('const s = reactive("let z = reactive(1), w")', [
            's',
            'z',
        ]),
    ).toEqual(['s'])
})

// A `{#for}` HEAD SPLITS ON THE COMMA AT DEPTH ZERO. The one inside a destructuring pattern is
// the pattern's own, and splitting there makes the item `{ id` — which both emitters write
// straight into a parameter list, so the module does not parse.
test('a destructuring loop item survives the head split', () => {
    const block = parseAbide('{#for { id, name } of rows}x{/for}')
        .template[0] as { item: string; index: string; subject: string }
    expect(block.item).toBe('{ id, name }')
    expect(block.index).toBe('')
    expect(block.subject).toBe('rows')

    const pair = parseAbide('{#for row, at of rows by row.id}x{/for}')
        .template[0] as { item: string; index: string; key: string }
    expect(pair.item).toBe('row')
    expect(pair.index).toBe('at')
    expect(pair.key).toBe('row.id')
})

// A CLOSE TAG CLOSES WHAT IT NAMES. Popping whatever is innermost instead lets `</br>` end the
// `<p>` around it and a stray `{/if}` end the `<div>` around it, and every node after it then
// hangs outside the element the author wrote it in — a different document, rendered without
// complaint.
//
// THE REVERT: `if (stack.length > 1) stack.pop()` on any close tag, and `blocks.pop()` plus a pop
// on any `{/if}`. The first case below then renders `<p><br></p>tail` and the second
// `<div></div><b>x</b>`.
test('a close tag closes what it names, and nothing else', () => {
    const stray = compileFile('<p><br></br>tail</p>')
    expect(stray).toContain('"<p>" + "<br>" + "tail" + "</p>"')

    const orphan = compileFile('<div>{/if}<b>x</b></div>')
    expect(orphan).toContain('"<div>" + "<b>" + "x" + "</b>" + "</div>"')
})

// A `<script>` IS A TAG WHERE THE PARSE REACHES ONE, and nowhere else. The blocks used to be cut
// out by an indexOf scan run BEFORE the template was parsed, which cannot tell a position from a
// position: the string literal below was lifted out of the expression and into component setup,
// moving the author's text from a data position into an executable one — and stripping it from the
// expression on the way, so the slot renders the wrong thing too.
//
// THE REVERT: cut `<script>`/`<style>` out with an indexOf pass over the whole source before
// parsing the template; this test then reports 1 script block where 0 are due, holding `boom()`.
test('a script tag inside an expression or an attribute is not a script block', () => {
    const inSlot = parseAbide(`<p>{ok ? "<script>boom()</script>" : ""}</p>`)
    expect(inSlot.scripts).toEqual([])
    expect(inSlot.template[0]).toMatchObject({
        children: [
            {
                kind: 'expression',
                source: `ok ? "<script>boom()</script>" : ""`,
            },
        ],
    })

    const inAttribute = parseAbide(`<p title="<style>x{y:z}</style>">a</p>`)
    expect(inAttribute.styles).toEqual([])

    // And a block the parse DOES reach is still the file's, wherever it stands.
    const nested = parseAbide(`<div><script>const a = 1</script></div>`)
    expect(nested.scripts).toEqual(['const a = 1'])
})

// A COMMENT AND A DOCTYPE ARE NOT TAGS, and there was no comment handling in the parser at all.
// THE REVERT: drop the `<!--` and `<!` cases and step over the `<` `readTag` refused; the comment
// below renders as the VISIBLE text `!-- todo -->`, the doctype as `!DOCTYPE html>`, and
// `<p>a < b</p>` silently loses its `<`.
test('a comment, a doctype and a bare < are not tags', () => {
    expect(compileFile('<div><!-- todo --><p>a</p></div>')).toContain(
        '"<div>" + "<p>" + "a" + "</p>" + "</div>"',
    )
    expect(compileFile('<!DOCTYPE html><p>a</p>')).toContain(
        '"<p>" + "a" + "</p>"',
    )
    expect(compileFile('<p>a < b</p>')).toContain('"<p>" + "a < b" + "</p>"')
    // One text node, not two: a browser merges adjacent text on parse and `planTemplate` counts
    // what the browser will see.
    const run = parseAbide('<p>a < b</p>').template[0] as {
        children: unknown[]
    }
    expect(run.children).toHaveLength(1)
})

// AN UNCLOSED QUOTE ATE THE FILE, which is the one failure a reader cannot see in the output —
// the output is a document that parses. THE REVERT: hand back `end: source.length` from `readTag`
// where the closing quote is missing; this test then reports a `<div>` with 0 children and the
// whole remainder of the page dropped, with nothing thrown.
test('an attribute quote that never closes is refused', () => {
    expect(() =>
        compileFile('<div class="card>\n<p>the rest of the page</p>\n</div>'),
    ).toThrow('never closed')
})

// A DIRECTIVE ENDS AT A WORD BOUNDARY. `startsWith` has none. THE REVERT: read the arm with
// `rest.startsWith('if')`; `{:elseif b}` is then silently accepted as `{:else if b}` and
// `{:else ifValid}` renders under the subject `Valid` — a condition the author never wrote,
// deciding which of two arms a reader sees.
test('an else arm is told from a name that starts with if', () => {
    expect(() => compileFile('{#if a}x{:elseif b}y{/if}')).toThrow(
        'not a control block',
    )
    expect(() => compileFile('{#if a}x{:else ifValid}y{/if}')).toThrow(
        'not a control block',
    )
    const arms = (
        parseAbide('{#if a}x{:else if b}y{:else}z{/if}').template[0] as {
            branches: { subject: string }[]
        }
    ).branches
    expect(arms.map((arm) => arm.subject)).toEqual(['a', 'b', ''])
})

// THE `{#for}` HEAD SPLITS AT DEPTH ZERO AND OUTSIDE A STRING. THE REVERT: split on `/ of /` and
// `/ by /` with a plain regex; the subject below ends mid-quote at `names.filter(n => n !== "run`
// and the key becomes `me")`, which the emitters write straight into the row function.
test('a for head splits outside its string literals', () => {
    const block = parseAbide(
        '{#for x of names.filter(n => n !== "run by me")}y{/for}',
    ).template[0] as { item: string; subject: string; key: string }
    expect(block.item).toBe('x')
    expect(block.subject).toBe('names.filter(n => n !== "run by me")')
    expect(block.key).toBe('')

    // A `{#for}` with nothing to iterate rendered zero rows forever and said nothing. 32.23 is an
    // ABSENT subject, which is a value; this is a missing one, which is a mistake.
    expect(() => compileFile('{#for rows}y{/for}')).toThrow('has no ` of `')
    // And one with no item has no binding for the row. THE REVERT is the `item === ''` refusal in
    // `forBlock`: both emitters then write `for (const  of …)`, a module that does not parse.
    expect(() => compileFile('{#for , i of rows}y{/for}')).toThrow(
        'names no item',
    )
})

// AN EXPRESSION SLOT HAS COMMENTS IN IT. THE REVERT: drop the comment and regex cases from
// `readExpression`; the first slot below ends at the `}` INSIDE the comment, so `x }` is emitted
// as markup, and the second opens a string at the apostrophe and swallows the rest of the
// document into one expression node — 1 page rendered as one slot.
test('a comment or a regular expression inside a slot does not end it', () => {
    expect(
        (
            parseAbide('<p>{ /* } */ x }</p>').template[0] as {
                children: { source: string }[]
            }
        ).children[0]?.source,
    ).toBe('/* } */ x')
    const after = parseAbide("<p>{x /* don't */}</p><b>tail</b>")
    expect(after.template).toHaveLength(2)
    expect(after.template[1]).toMatchObject({ kind: 'element', tag: 'b' })
    expect(
        (
            parseAbide('<p>{xs.filter(s => /}/.test(s)).length}</p>')
                .template[0] as { children: { source: string }[] }
        ).children[0]?.source,
    ).toBe('xs.filter(s => /}/.test(s)).length')
    // And `{/for}` is the template's own grammar, not a regular expression opening.
    expect(compileFile('{#for r of rs}<li>x</li>{/for}')).toContain('</li>')
})

// 32.21 NAMES THE INTERPOLATION, and the check ran on the path the clause does not name: a literal
// `javascript:` href was dropped while `<a href={u}>` was served verbatim — the one of the two
// where untrusted data actually arrives. THE REVERT: return from the expression branch of
// `emitAttribute` before the URL guard; the rendered document below then carries 1 live
// `javascript:` href where 0 are due.
test('an interpolated url is scheme-checked too', async () => {
    const page = `<script>
const u = 'javascript:alert(1)'
const ok = '/docs'
</script>
<a id="bad" href={u}>x</a><a id="good" href={ok}>y</a>`
    expect(compileFile(page)).toContain('safeUrl(')

    const dir = temporaryModule({ 'Page.ts': compileFile(page) })
    const { default: Page } = await import(`${dir}/Page.ts`)
    let out = ''
    for await (const chunk of render(Page, '<html><body></body></html>'))
        out += new TextDecoder().decode(chunk)
    expect(out).not.toContain('javascript:')
    expect(out).toContain('href="/docs"')
})

// A BROWSER DOES NOT PARSE THE BYTES IT WAS SENT: it trims C0 and spaces, strips tab, LF and CR,
// and decodes entities BEFORE it looks for a scheme, so all three of these navigate. THE REVERT:
// match the scheme against the raw value in `safeUrl` and escape only `"` on the static attribute
// path; this test then reports 3 live `javascript:` hrefs where 0 are due.
test('a url is checked against what the browser will read', () => {
    for (const href of [
        ' javascript:alert(1)',
        'java\tscript:alert(1)',
        'java\nscript:alert(1)',
        'JaVaScRiPt:alert(1)',
    ])
        expect(compileFile(`<a href="${href}">x</a>`)).not.toContain('alert(1)')

    // The entity takes a different road and is stopped one layer up: ONE escaping rule for one
    // context means the `&` is encoded, so `&#106;` never becomes a `j`.
    const entity = compileFile(`<a href="&#106;avascript:alert(1)">x</a>`)
    expect(entity).toContain('&amp;#106;avascript:alert(1)')
    expect(entity).not.toContain('"&#106;')
    // And an ordinary query string is escaped the same way, by the same function.
    expect(compileFile(`<a href="/a?x=1&y=2">z</a>`)).toContain(
        '/a?x=1&amp;y=2',
    )
})

// AN HTML ATTRIBUTE NAME IS CASE-INSENSITIVE. THE REVERT: pass `attribute.name` to `isEventName`;
// `ONCLICK={h}` is then emitted into the markup as a live attribute, in a document that never
// hydrated — 1 handler a browser will run where 0 are due, and `onClick` is dropped beside it.
test('an event name is matched case-insensitively', () => {
    for (const name of ['onclick', 'onClick', 'ONCLICK', 'OnClick']) {
        const emitted = compileFile(
            `<script>const h = () => {}</script><button ${name}={h}>x</button>`,
        )
        expect(emitted.toLowerCase()).not.toContain('onclick=')
    }
    // An attribute that is not `on<event>` is still an attribute, whatever its case.
    expect(compileFile(`<div DATA-X={x}>a</div>`)).toContain('DATA-X')
})

// 39.2 HAS TWO HALVES and only the first was checked: the walk returned on anything that was not
// an element, so a control block was a floor it never went through. THE REVERT: return early from
// `assertNoNestedHead` on a non-element node; the first case below then emits `<head>` markup into
// the BODY, and the second emits a second `<head>` inside the document head.
test('a head inside a control block or inside a head is refused', () => {
    expect(() =>
        compileFile('{#if a}<head><title>t</title></head>{/if}'),
    ).toThrow('39.2')
    expect(() =>
        compileFile('{#for r of rs}<head><title>t</title></head>{/for}'),
    ).toThrow('39.2')
    expect(() =>
        compileFile('<head><head><title>t</title></head></head>'),
    ).toThrow('39.2')
    expect(() =>
        compileFile('<div>{#if a}<head><title>t</title></head>{/if}</div>'),
    ).toThrow('39.2')
})

// AN HTML ATTRIBUTE NAME IS ASCII CASE-INSENSITIVE, so the parser answers `href` for every
// spelling of it and 32.21 has to as well. Compared as written, a capital letter walked past the
// check on BOTH paths — the interpolated one lost its `safeUrl` wrapper and the literal one was
// copied through byte for byte.
//
// THE REVERT: compare `name` against the lowercase literals without lowering it first. This test
// then reports 4 live `javascript:` hrefs where 0 are due, and a real browser navigates all four.
test('a url attribute is recognised however it is capitalised', () => {
    for (const name of ['HREF', 'Href', 'SRC', 'FormAction']) {
        expect(
            compileFile(`<a ${name}="javascript:alert(1)">x</a>`),
        ).not.toContain('alert(1)')
        expect(
            compileFile(
                `<script>\nconst u = '/ok'\n</script>\n<a ${name}={u}>x</a>`,
            ),
        ).toContain('safeUrl(')
    }
})

// `</head>` AND `</body>` ARE BOTH OPTIONAL END TAGS, so a valid shell may carry neither — and
// the three hand-written output shapes this replaces dropped the component's head contribution on
// the floor in two of them, with no error anywhere.
//
// THE REVERT: restore the `bodyAt === -1` and `headAt === -1` early returns in `render`. This test
// then reports 0 of 4 shells carrying the title where 4 are due.
test('a shell missing either end tag still receives the head', async () => {
    const module = `${temporaryModule({ 'Page.ts': compileFile(PAGE) })}/Page.ts`
    const { default: Page } = await import(module)
    const shells = [
        '<!doctype html><html><head></head><body></body></html>',
        '<!doctype html><html><body></body></html>',
        '<!doctype html><html><head></head></html>',
        '<!doctype html><html></html>',
        // The head written AFTER the body: `slice(headAt, bodyAt)` was empty and the head region
        // came out twice with the app's body outside any `<body>`.
        '<!doctype html><html><body></body><head></head></html>',
    ]
    const carried: string[] = []
    for (const shell of shells) {
        let out = ''
        for await (const chunk of render(Page, shell))
            out += new TextDecoder().decode(chunk)
        const head = out.indexOf('<title>abide</title>')
        const body = out.indexOf('<h1 class="title">')
        carried.push(
            `head ${head === -1 ? 'DROPPED' : 'kept'} body ${body === -1 ? 'DROPPED' : 'kept'} ordered ${head < body}`,
        )
    }
    expect(carried).toEqual([
        'head kept body kept ordered true',
        'head kept body kept ordered true',
        'head kept body kept ordered true',
        'head kept body kept ordered true',
        'head kept body kept ordered true',
    ])
})

// THE REWRITE COPIES THE TAIL IN SLICES rather than one character at a time, so what it must not
// do is lose or reorder anything between two escapes — including a surrogate PAIR, which is two
// code units that only mean an emoji when they stay adjacent.
//
// THE REVERT: drop the `if (i > cut) out += text.slice(cut, i)` and let the loop skip past
// unescaped characters. Every case below then loses its whole tail: `a&b` renders `a&amp;` where
// `a&amp;b` is due, 5 of 6 wrong.
test('escaping keeps everything between and after the escapes', () => {
    const cases: [string, string][] = [
        ['a&b', 'a&amp;b'],
        ['&lead', '&amp;lead'],
        ['trail&', 'trail&amp;'],
        ['a&b<c>d', 'a&amp;b&lt;c&gt;d'],
        ['&<>', '&amp;&lt;&gt;'],
        ['wave 👋 & wave 👋', 'wave 👋 &amp; wave 👋'],
    ]
    expect(cases.map(([raw]) => escapeText(raw))).toEqual(
        cases.map(([, want]) => want),
    )
})

// 31.10 — A TEMPLATE-LOCAL BINDING SHADOWS A NAME BOUND TO A `Reactive` FOR THE BODY IT IS BOUND
// IN. THE REVERT: pass `reactive` rather than `inner` to `emitChildren` in `emitComponent`'s
// `{#for}` branch and to `emitMarkup`/`emitRegion` in `emitClient`'s `emitList`. Both emitters
// then write `for (const rows of __list) { … rows().name … }` — 2 bodies calling a row as a
// function, which is `rows is not a function` thrown on the server render of a page that named
// one thing twice.
test('a for item shadows a reactive name of the same spelling', async () => {
    const source =
        '<script>let rows = reactive([])</script>{#for rows of groups}<li>{rows.name}</li>{/for}'
    const server = await serverOf(source, ['rows'])
    expect(server).toContain('for (const rows of __list)')
    expect(server).toContain('__escapeText(rows.name)')
    expect(server).not.toContain('rows().name')
    // The SUBJECT is outside the binding and keeps the page's set. Wrapped for 41.4 because
    // it reads a `Reactive`; the row's own item, which cannot be unlanded, is not.
    const subject = await serverOf(
        '<script>let rows = reactive([])</script>{#for row of rows}<li>{row}</li>{/for}',
        ['rows'],
    )
    expect(subject).toContain('__listOf(__slotValue(() => rows()))')
})

// A DEFAULT VALUE IS READ, NOT BOUND. The row's pattern binds `tone`, so the body's `{tone}` is the
// row's own; `rows` is only READ by a default, so the page's `rows` is still what `{rows}` reaches.
// THE REVERT: project a `{#for}` body flat in `projectShadow`, with no `for … of` binding its item;
// `{tone}` then reaches the page's `tone` and lowers to `tone()` — a call on the row's string.
test('a default value in a binding pattern is read, not bound — 31.10', async () => {
    const names = ['rows', 'tone', 'items']
    const server = await serverOf(
        '{#for { id, tone = pick(rows) } of items}<i>{tone}{rows}</i>{/for}',
        names,
    )
    expect(server).toContain('__escapeText(tone)')
    expect(server).toContain('__escapeText(__slotValue(() => rows()))')
    // A rename binds the right of the `:` and reads the left.
    const renamed = await serverOf(
        '{#for { id: rows } of items}<i>{rows}{tone}</i>{/for}',
        names,
    )
    expect(renamed).toContain('__escapeText(rows)')
    expect(renamed).toContain('__escapeText(__slotValue(() => tone()))')
})

// THE CLIENT HALF IS ITS OWN GATE, because the row's MARKUP and the row's BINDINGS are emitted by
// two different paths and a shadow threaded to one is not threaded to the other. THE REVERT: pass
// `reactive` rather than `inner` to `emitMarkup` and to `emitRegion` in `emitClient`'s `emitList`.
// The markup then reads `rows().name`, and the run reads as reactive so a `setText` binding is
// opened over it as well — 2 sites calling a row parameter as a function, and a waking reader that
// should not exist, on a page whose server render is fine.
test('a for row binds its item on the client too', async () => {
    const client = await clientOf(
        '<script>let rows = reactive([])</script>{#for rows of groups}<li>{rows.name}</li>{/for}',
        ['rows'],
    )
    expect(client).toContain('const ls0_make = (rows, __at)')
    expect(client).toContain('__escapeText(rows.name)')
    // The row's own item is not a `Reactive`, so the run opens NO binding: the reconcile is what
    // rewrites a row whose data changed.
    expect(client).not.toContain('setText')
    expect(client).not.toContain('rows()')
    // The subject is outside the binding on this side too.
    expect(
        await clientOf(
            '<script>let rows = reactive([])</script>{#for row of rows}<li>{row.name}</li>{/for}',
            ['rows'],
        ),
    ).toContain('const ls0_subject = () => rows()')
})

// AN INDEX AND A DESTRUCTURED ITEM BIND TOO, and a `by` key is inside the binding while the
// subject is not.
test('a for index and a destructured item shadow as the item does', async () => {
    const indexed = await serverOf(
        '<script>let at = reactive(0)</script>{#for row, at of rows}<li>{at}</li>{/for}',
        ['at'],
    )
    expect(indexed).toContain('__escapeText(at)')
    expect(indexed).not.toContain('__escapeText(at())')

    const destructured = await serverOf(
        '<script>let name = reactive(0)</script>{#for { id, name } of rows}<li>{name}</li>{/for}',
        ['name'],
    )
    expect(destructured).toContain('__escapeText(name)')
    expect(destructured).not.toContain('__escapeText(name())')

    // A KEY IS READ INSIDE THE BINDING. `by id` names the row's own `id`, not the page's.
    const keyed = await clientOf(
        '<script>let id = reactive(0)</script>{#for id of rows by id}<li>{id}</li>{/for}',
        ['id'],
    )
    expect(keyed).toContain('const ls0_key = (id, __at) => id')
})

// 32.3 — A `name={expr}` ATTRIBUTE IS REACTIVE, WHOLE OR INTERPOLATED. THE REVERT: drop the
// `pushQuoted` call in `readTag` and push the raw quoted value as a literal again; the braces then
// reach the document verbatim — `class="badge {tone}"` is served as the author's source, and the
// scheme check 32.21 asks for never runs on the interpolated `href` at all.
// biome-ignore-start lint/suspicious/noTemplateCurlyInString: the emitted template literal IS the
// subject — an interpolated attribute lowers to one, and asserting it means spelling it.
test('an interpolated quoted attribute is one expression', async () => {
    const emitted = await serverOf('<div class="badge {tone}">x</div>', [
        'tone',
    ])
    expect(emitted).toContain(
        '__escapeAttribute(__slotValue(() => `badge ${tone()}`))',
    )
    expect(emitted).not.toContain('badge {tone}')
    // Several slots and the text between them.
    expect(compileFile('<div title="a{b}c{d}e">x</div>')).toContain(
        '__escapeAttribute(`a${b}c${d}e`)',
    )
    // 32.21 — an interpolated URL-typed attribute is scheme-checked where the value arrives.
    expect(compileFile('<a href="/x/{id}">x</a>')).toContain(
        '__safeUrl(`/x/${id}`)',
    )
    // A value with NO slot is still a literal, and its braces are text.
    expect(compileFile('<div class="badge">x</div>')).toContain(
        '<div class=\\"badge\\">',
    )
    // AN UNCLOSED `{` IS TEXT, not a slot that swallows the rest of the value.
    expect(compileFile('<div class="a { b">x</div>')).toContain(
        '<div class=\\"a { b\\">',
    )
})

// 32.20 — AN INTERPOLATED `style` LOWERS TO `style:prop` UNDER A STATIC PROPERTY NAME. THE REVERT:
// have `pushQuoted` take the `style` branch as it takes every other name, so the whole declaration
// list becomes one interpolated string; the emitted attribute is then a string built from a value,
// which is the half of the clause the property name exists to stop.
test('an interpolated style lowers to one attribute per property', async () => {
    const attributes = (
        parseAbide('<div style="color: {c}; width: {w}px">x</div>')
            .template[0] as { attributes: { name: string }[] }
    ).attributes
    expect(attributes.map((a) => a.name)).toEqual([
        'style:color',
        'style:width',
    ])

    // 32.10 — every `style:prop` on one element is ONE `style` attribute. Two of them on a tag is
    // markup a browser reads as the first only.
    const emitted = await serverOf(
        '<div style="color: {c}; width: {w}px">x</div>',
        ['c', 'w'],
    )
    expect(emitted).toContain(
        '"<div style=\\"" + "color: " + __escapeStyleValue(__slotValue(() => `${c()}`)) + "; width: " + __escapeStyleValue(__slotValue(() => `${w()}px`))',
    )
    expect(emitted.match(/style=\\"/g)).toHaveLength(1)

    // The combined attribute stands where the FIRST style contribution did.
    expect(
        compileFile('<div class="a" style="--Brand: {c}" id="z">x</div>'),
    ).toContain('<div class=\\"a\\" style=\\"')

    // A STATIC `style` IS NOT INTERPOLATED and keeps the literal path; a WHOLE `style={expr}` is
    // 32.3's and keeps the computed one.
    expect(compileFile('<div style="color: red">x</div>')).toContain(
        '<div style=\\"color: red\\">',
    )
    expect(compileFile('<div style={s}>x</div>')).toContain(
        '<div style=\\"" + __escapeAttribute(s)',
    )

    // A PROPERTY NAME THAT IS NOT STATIC has no property to bind and is refused.
    expect(() => compileFile('<div style="{p}: red">x</div>')).toThrow('32.20')
    expect(() => compileFile('<div style="red {c}">x</div>')).toThrow('32.20')
})
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: the emitted template literal IS the
// subject.

// 34.2 — A `<script module>` IS REQUEST-LOCAL ON A SERVER AND PROCESS-WIDE IN A BROWSER, which is
// two different places to emit it and neither is where a `<script>` goes. THE REVERT: have
// `scriptBlock` hand back `scripts` for the `module` attribute too; both bodies then land in the
// per-instance block and the browser runs the module body once per `mount` — a counter that resets
// on every mount, with the right value on the first one and nothing saying so after.
test('a script module is a block of its own on each side', async () => {
    const source =
        '<script module>let hits = 0</script><script>let n = reactive(0)</script><p>{n}</p>'
    const file = parseAbide(source)
    expect(file.modules).toEqual(['let hits = 0'])
    expect(file.scripts).toEqual(['let n = reactive(0)'])

    // REQUEST-LOCAL is the head of the component, ahead of the per-instance body.
    const server = await serverOf(source, ['n'])
    const component = server.indexOf('export default function Component() {')
    expect(server.indexOf('let hits = 0')).toBeGreaterThan(component)
    expect(server.indexOf('let n = reactive(0)')).toBeGreaterThan(
        server.indexOf('let hits = 0'),
    )

    // PROCESS-WIDE is module scope, ahead of `mount`.
    const client = await clientOf(source, ['n'])
    expect(client).toContain(
        'let hits = 0\nexport default function mount(root) {',
    )
    expect(client.indexOf('let hits = 0')).toBeLessThan(
        client.indexOf('export default function mount'),
    )
    expect(client.indexOf('let n = reactive(0)')).toBeGreaterThan(
        client.indexOf('export default function mount'),
    )
})

// 34.1 AND 34.2 ARE THE TWO FORMS, AND EVERY OTHER `<script>` IS MARKUP. THE REVERT: have
// `scriptBlock` hand back `scripts` whatever the attributes are; the two tags below are then
// lifted into component setup with their attributes thrown away — the document loses both, and
// the JSON-LD body is emitted as a JavaScript statement, so the module does not parse at all.
test('a script the author wrote for the document stays in the markup', async () => {
    const file = parseAbide(
        '<script src="/a.js"></script><script type="application/ld+json">{"@type":"Thing"}</script>',
    )
    expect(file.scripts).toEqual([])
    expect(file.modules).toEqual([])
    expect(file.template).toHaveLength(2)
    expect(file.template[0]).toMatchObject({
        kind: 'element',
        tag: 'script',
        attributes: [{ name: 'src', value: '/a.js', expression: false }],
    })
    // THE BODY IS TEXT, NOT TEMPLATE. A `{` in JSON read as a slot takes the rest of the file.
    expect(file.template[1]).toMatchObject({
        children: [{ kind: 'text', text: '{"@type":"Thing"}' }],
    })

    const emitted = compileFile(
        '<script src="/a.js"></script><script type="application/ld+json">{"@type":"Thing"}</script>',
    )
    expect(emitted).toContain('<script src=\\"/a.js\\">')
    expect(emitted).toContain('{\\"@type\\":\\"Thing\\"}')
    // `module="x"` names something else and is not 34.2's marker.
    expect(parseAbide('<script module="x">let a = 1</script>').scripts).toEqual(
        [],
    )
})

// One document out of one page, for the three gates below.
async function renderPage(source: string): Promise<string> {
    const module = `${temporaryModule({ 'Page.ts': compileFile(source) })}/Page.ts`
    const { default: Page } = await import(module)
    let out = ''
    for await (const chunk of render(
        Page,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        out += new TextDecoder().decode(chunk)
    return out
}

// 32.25, 32.26, 32.27 — `{raw(...)}` IS A CALL TO A NAME THAT EXISTS. It lowered to
// `escapeText(raw(html))` against a `raw` no seam exported, so 32.2's one spelling was a
// `ReferenceError` at render — and had it resolved, the escape around it would have escaped the
// markup the call was made to keep. ONE MECHANISM: the slot lowers to the same export an author
// imports, so the two rows below are the same object taking the same road.
//
// THE REVERT: drop `if (value instanceof Raw) return value.html` from `escapeText`. Both rows
// then report `[object Object]` where `<b>bold</b>` is due — the IMPORT row too, which is what
// says the brand and not the spelling is what carries it.
//
// AND THE SECOND REVERT, which the first page cannot make: drop `rawCalls` from `Lowering`'s splice.
// The page above still passes, its own `<script>` having imported `raw` — so the second page below
// carries no import, and without the lowering it reports
// `ReferenceError: Can't find variable: raw` and no document at all. That is what 32.2's one
// spelling did before any of this.
const RAW_PAGE = `<script>
import { raw } from 'abide'

const snippet = '<b>bold</b>'
const branded = raw(snippet)
</script>

<p id="slot">{raw(snippet)}</p>
<p id="imported">{branded}</p>
<p id="escaped">{snippet}</p>`

// 32.26, WITHOUT THE IMPORT. The spelling is the template's, so the name it lowers to has to be
// the compiler's own — this is the page the one above cannot stand in for.
const RAW_UNIMPORTED = `<script>
const snippet = '<b>bold</b>'
</script>

<p id="slot">{raw(snippet)}</p>`

test('a raw value renders as markup, from the slot spelling and from an import alike', async () => {
    const out = await renderPage(RAW_PAGE)
    expect(out).toContain('<p id="slot"><b>bold</b></p>')
    expect(out).toContain('<p id="imported"><b>bold</b></p>')
    // 32.1 is untouched by any of it: a value nobody branded is still escaped.
    expect(out).toContain('<p id="escaped">&lt;b&gt;bold&lt;/b&gt;</p>')

    const bare = await renderPage(RAW_UNIMPORTED)
    expect(bare).toContain('<p id="slot"><b>bold</b></p>')
})

test('the raw spelling lowers to the framework’s own name, on both sides', async () => {
    const server = compileFile(RAW_PAGE)
    expect(server).toContain('__escapeText(__raw(snippet))')
    expect(server).toContain('raw as __raw')
    // A MEMBER IS NOT THE NAME, and a bare reference is not the spelling: neither is rewritten.
    expect(compileFile('<p>{md.raw(x)}</p>')).not.toContain('__raw')
    expect(compileFile('<p>{raw}</p>')).not.toContain('__raw')
    // The client takes the same road AND the two rewrites compose in one walk: the call is
    // renamed and the page's own name inside it is read.
    const client = await clientOf(
        RAW_PAGE.replace(
            "const snippet = '<b>bold</b>'",
            "const snippet = reactive('<b>bold</b>')",
        ),
    )
    expect(client).toContain('__escapeless(__raw(snippet()))')
})

// 39.11, 39.12 — THE MERGE KEY, and the last contribution for one wins. Two `<title>` elements in
// one file put two into the document and a browser keeps the first, so the page's own later
// answer was the one dropped — silently, by the markup rather than by anything the compiler said.
//
// A KEY THE COMPILER CANNOT READ IS NO KEY: `<meta name={x}>` names something only the run time
// knows, so it appends under 39.5 rather than merging against a string that is not its value.
//
// THE REVERT: `return children` at the top of `mergeHead`. This test then reports 2 `<title>` and
// 2 `description` where 1 of each is due, and the first of each pair — the one a browser obeys —
// is the one the author overwrote.
const HEADS = `<head>
    <title>first</title>
    <meta name="description" content="first"/>
    <link rel="stylesheet" href="/a.css"/>
    <meta property="og:title" content="first"/>
</head>

<script>
const named = 'robots'
</script>

<head>
    <title>second</title>
    <meta name="description" content="second"/>
    <link rel="stylesheet" href="/b.css"/>
    <meta property="og:title" content="second"/>
    <meta name={named} content="dynamic"/>
    <meta charset="utf-8"/>
</head>

<p>body</p>`

test('a head contribution merges by key, and the last one for a key wins', async () => {
    const out = await renderPage(HEADS)
    const head = out.slice(0, out.indexOf('</head>'))

    expect([...head.matchAll(/<title>/g)]).toHaveLength(1)
    expect(head).toContain('<title>second</title>')

    // `<meta>` keys on `name`, and on `property` where it carries one.
    expect([...head.matchAll(/name="description"/g)]).toHaveLength(1)
    expect(head).toContain('<meta name="description" content="second">')
    expect([...head.matchAll(/og:title/g)]).toHaveLength(1)
    expect(head).toContain('<meta property="og:title" content="second">')

    // `<link>` keys on `rel` WITH `href`, so two stylesheets are two contributions.
    expect(head).toContain('href="/a.css"')
    expect(head).toContain('href="/b.css"')

    // 39.5 — no key, so it appends: a `name` only the run time knows, and a `<meta charset>`
    // carrying neither `name` nor `property`.
    expect(head).toContain('name="robots" content="dynamic"')
    expect(head).toContain('charset="utf-8"')
})

// 32.28, 32.29 — STATIC TEMPLATE TEXT IS MARKUP. `title="AT&amp;T"` went through the same rewrite
// an interpolated value takes and rendered `AT&amp;T` on the page, while the same six characters
// between two tags rendered `AT&T` — one template answering one question two ways.
//
// AND 32.29 IS WHY THE NARROWING STOPS AT A URL. `safeUrl` reads the bytes, so
// `&#106;avascript:` is a relative reference to it and `javascript:` to the browser that decodes
// the entity — encoding the `&` is the only thing between the two.
//
// BOTH DIRECTIONS ARE REVERTS, and one alone gates half of it.
//
// NARROW TOO FAR — `quoteOnly` for every attribute, `isUrlAttribute` included — and the document
// carries `href="&#106;avascript:alert(1)"` where `&amp;#106;` is due, which is a `javascript:`
// URL on an anchor a click reaches.
//
// NARROW NOT AT ALL — `escapeAttribute` for every attribute, which is the shape before this — and
// the same document carries `title="AT&amp;amp;T &amp;copy;"` where the author wrote `AT&amp;T
// &copy;`, and `value="say &amp;quot;hi&amp;quot;"` where they wrote `say &quot;hi&quot;`. The
// body text one line above renders both correctly in the same document, which is the split.
test('a static attribute value is markup, and a URL attribute is still escaped', async () => {
    const out = await renderPage(
        `<p>AT&amp;T &copy; &nbsp;</p>
<abbr id="a" title="AT&amp;T &copy;">AT&amp;T</abbr>
<a id="b" href="&#106;avascript:alert(1)">x</a>
<a id="c" href="/search?q=1&amp;page=2">y</a>
<input id="d" value="say &quot;hi&quot;"/>
<i id="e" style:content="'&copy;'">c</i>`,
    )

    // The two contexts answer alike now: what the author wrote is what the document carries.
    expect(out).toContain('<p>AT&amp;T &copy; &nbsp;</p>')
    expect(out).toContain('title="AT&amp;T &copy;"')

    // 32.29 — the entity never forms, so the scheme check behind it is never reached past.
    expect(out).toContain('href="&amp;#106;avascript:alert(1)"')
    expect(out).not.toContain('href="&#106;avascript:alert(1)"')
    expect(out).toContain('href="/search?q=1&amp;amp;page=2"')

    // A `"` is still encoded wherever it lands: it would end the attribute.
    expect(out).toContain('value="say &quot;hi&quot;"')

    // ONE ATTRIBUTE, ONE ANSWER, however it was spelled: a static `style:prop` declaration is the
    // author's markup the same way a whole `style="…"` is.
    expect(out).toContain(`style="content: '&copy;'"`)
})

// The template parser's own scanners, each of which swallowed the rest of the document.
test('a slot ends where JavaScript says it ends', () => {
    const tags = (nodes: ReturnType<typeof parseAbide>['template']): string =>
        nodes
            .map((node) => (node.kind === 'element' ? node.tag : node.kind))
            .join(' ')
    // A non-null assertion ENDS an operand, so the `/` after it divides. Read as a regex, the
    // literal terminated on the `/` of the `</p>` and took the close tag with it.
    expect(
        tags(parseAbide('<p>{count! / total}</p><footer>f</footer>').template),
    ).toBe('p footer')
    // `return` is a keyword, so the `/` after it OPENS one. `previous` is a character and cannot
    // tell it from an identifier.
    expect(
        tags(
            parseAbide(
                '<p>{ (() => { return /\\s{2,}/.test(s) })() }</p><footer>f</footer>',
            ).template,
        ),
    ).toBe('p footer')
    // A template literal's substitution is code: the backtick inside it ends nothing.
    expect(
        tags(parseAbide('<p>{`x${ f("`") }y`}</p><footer>f</footer>').template),
    ).toBe('p footer')
    // Still a regular expression where one is meant.
    expect(
        tags(
            parseAbide(
                '<p>{ xs.filter(s => /}/.test(s)) }</p><footer>f</footer>',
            ).template,
        ),
    ).toBe('p footer')
})

// `{/for}` and `{/if}` take whitespace before the brace, and the lookahead that read them was
// narrower than the pattern it held.
test('a close directive takes whitespace before its brace', () => {
    const file = parseAbide(
        '<ul>{#for x of xs}<li>{x}</li>{/for    }</ul><p>after</p>',
    )
    expect(
        file.template.map((node) =>
            node.kind === 'element' ? node.tag : node.kind,
        ),
    ).toEqual(['ul', 'p'])
})

// A raw-text close tag takes whitespace before its `>`. Demanded at a fixed offset, the rest of
// the document became the script body and the template came back empty.
test('a raw-text block closes on a spaced close tag', () => {
    const file = parseAbide('<script>let a = 1</script >\n<p>x</p>')
    expect(file.scripts).toEqual(['let a = 1'])
    expect(
        file.template.some(
            (node) => node.kind === 'element' && node.tag === 'p',
        ),
    ).toBe(true)
})

// `<//>` trims to the ARM sentinel, which popped the stack floor and crashed the next iteration.
test('a stray close tag does not pop the stack floor', () => {
    const file = parseAbide('<p>a</p><//><div>b</div>')
    expect(
        file.template
            .filter((node) => node.kind === 'element')
            .map((node) => (node as { tag: string }).tag),
    ).toEqual(['p', 'div'])
})

// An element left open inside a block must not swallow what follows the block. Requiring the arm
// to be innermost, `{/if}` closed nothing and the `<p>` landed inside the branch.
test('a close directive unwinds an element left open inside it', () => {
    const file = parseAbide('<div>{#if a}<b>x{/if}</div><p>after</p>')
    expect(
        file.template.map((node) =>
            node.kind === 'element' ? node.tag : node.kind,
        ),
    ).toEqual(['div', 'p'])
})

// 32.21's scheme check is keyed on the attribute NAME, and four names was not the set.
test('a URL-typed attribute is scheme-checked under every spelling of one', () => {
    const svg = compileFile(
        '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    )
    expect(svg).not.toContain('javascript:')
    const poster = compileFile('<video poster="javascript:alert(1)"></video>')
    expect(poster).not.toContain('javascript:')
    // A relative URL under the same names is untouched.
    expect(compileFile('<svg><a xlink:href="/x">y</a></svg>')).toContain('/x')
})

// A plain `style` and a `style:prop` are ONE attribute. Written apart, HTML keeps the first and
// the reactive declaration is dropped in silence.
test('a static style merges with its style: directives', () => {
    const server = compileFile(
        '<div style="color: red" style:width="3px">x</div>',
    )
    expect(server.split('style=').length - 1).toBe(1)
    expect(server).toContain('color: red')
    expect(server).toContain('width: 3px')
})

// 32.10 — A `class:name` IS ONE CLASS, and the author's own `class` is a member of the same
// merge. THE REVERT: drop `class` from `MERGED`; this emits the literal attribute
// `class:overdue="true"` beside `class="badge"` — two `class`-ish attributes, one of which no
// stylesheet can match and no browser reads as a class at all.
test('a class: directive merges into the one class attribute', async () => {
    const server = await serverOf(
        '<p class="badge" class:overdue={late}>x</p>',
        ['late'],
    )
    expect(server).not.toContain('class:overdue')
    expect(server.split('class=').length - 1).toBe(1)
    // THE NAME IS MARKUP AND THE VALUE IS A CONDITION: the name is written where the expression
    // is truthy and nothing is written where it is not, which is what makes a class different
    // from every other attribute value.
    expect(server).toContain('"badge"')
    expect(server).toContain('" overdue" : \'\'')
})

// TWO OF THEM ON ONE TAG ARE STILL ONE ATTRIBUTE, which is the whole reason the merge exists —
// written apart they are two `class=` attributes and a browser keeps the first, so the second
// name never reaches the document. THE REVERT: drop `class` from `MERGED`; the count below reads
// 0, because what is emitted then is `class:a=` and `class:b=`, which is not a class attribute at
// all rather than two of them.
test('every class: directive on a tag is one class attribute', async () => {
    const server = await serverOf('<p class:a={x} class:b={y}>t</p>', [
        'x',
        'y',
    ])
    expect(server.split('class=').length - 1).toBe(1)
    expect(server).toContain('" a" : \'\'')
    expect(server).toContain('" b" : \'\'')
})

// A `class:name` WITH NO EXPRESSION is a name with no condition on it, and a name always written
// is what the author's own `class` attribute already is — so it renders as one rather than being
// refused. A BARE `class:` names nothing and stays an ordinary attribute, which is the same floor
// `style:` has.
test('a class: directive with no condition is a plain class', () => {
    const always = compileFile('<p class="a" class:b>t</p>')
    expect(always.split('class=').length - 1).toBe(1)
    expect(always).toContain('"a"')
    expect(always).toContain('" b"')
    expect(compileFile('<p class:>t</p>')).toContain('class:')
})

// 32.10 ON THE CLIENT — the binding goes through `classList`, not through the merged attribute.
// THE REVERT: give the `class` write `setAttribute`; the emitted binding then writes the whole
// attribute from one name and takes `badge` off the element on its first run.
test('a class: directive binds one class and not the attribute', async () => {
    const client = await clientOf(
        '<p class="badge" class:overdue={late}>x</p>',
        ['late'],
    )
    expect(client).toContain('__setClass(__a0, "overdue", late())')
    expect(client).not.toContain('__setAttribute')
})

// An HTML tag name is case-insensitive, and `<HEAD>` was never hoisted.
test('a head contributes under any casing', () => {
    const out = compileFile('<HEAD><title>T</title></HEAD><p>x</p>')
    expect(out).toContain('<title>')
    expect(out.indexOf('<title>')).toBeLessThan(out.indexOf('body:'))
})

// A DEFAULT VALUE HOLDING ITS OWN `=` IS STILL ONE DEFAULT. The checker parses the pattern, so the
// `=` inside `pick(seed = 1)` cannot end it and `rows` after it is a read.
test('a default value holding an `=` is skipped whole — 31.10', async () => {
    const server = await serverOf(
        '{#for { id, tone = pick(seed = 1) + rows } of items}<i>{tone}{rows}</i>{/for}',
        ['rows', 'tone', 'items', 'seed'],
    )
    expect(server).toContain('__escapeText(tone)')
    expect(server).toContain('__escapeText(__slotValue(() => rows()))')
})

// THE TWO EMITTERS FILTER THE SAME `<head>`, and a tag name is ASCII case-INSENSITIVE. Only the
// server was lowercased, so `<HEAD>` was hoisted out of the document on one side and counted as a
// body child on the other — every client path after it off by one, and because the root's
// bindings share one guard the first Mismatch abandons the whole mount. THE REVERT: compare
// `node.tag === 'head'` in `emitClient`; the client path below becomes `[1,0]`.
test('an uppercase head is hoisted by both emitters', async () => {
    const source = '<HEAD><title>t</title></HEAD><p>{n}</p>'
    expect(await serverOf(source, ['n'])).toContain(
        '__body = "<p>" + __escapeText(__slotValue(() => n())) + "</p>"',
    )
    expect(await clientOf(source, ['n'])).toContain(
        '__textAt(root, [0,0], true)',
    )
})

// 32.3 HOLDS WHETHER OR NOT THE VALUE IS QUOTED. THE REVERT: push the unquoted value as a literal
// attribute; this reports the author's own `{id}` braces served as the attribute text, unlowered
// and past the `safeUrl` 32.21 asks a URL attribute for.
test('a slot in an unquoted attribute value is an expression', async () => {
    expect(await serverOf('<a href=/x/{id}>y</a>', ['id'])).toContain(
        '__escapeAttribute(__safeUrl(__slotValue(() => `/x/${id()}`)))',
    )
    expect(await serverOf('<a class=badge-{tone}>y</a>', ['tone'])).toContain(
        '__escapeAttribute(__slotValue(() => `badge-${tone()}`))',
    )
    // A value with no slot in it stays a literal.
    expect(compileFile('<a href=/plain>y</a>')).toContain('href=\\"/plain\\"')
})

// 32.10 — a `style:prop` sets ONE property, and `escapeAttribute` cannot see the character that
// says otherwise: `;` is ordinary in every other attribute. THE REVERT: emit `escapeAttribute`
// here; a value off the wire then writes a whole declaration list into the merged attribute.
test('an interpolated style property cannot set a second one', async () => {
    expect(await serverOf('<div style:color={v}>x</div>', ['v'])).toContain(
        '__escapeStyleValue(__slotValue(() => v()))',
    )
    expect(escapeStyleValue('red; position: fixed; top: 0')).toBe('red')
    // A WHOLE `style={expr}` IS A DECLARATION LIST and keeps the attribute escaping.
    expect(await serverOf('<div style={s}>x</div>', ['s'])).toContain(
        '__escapeAttribute(__slotValue(() => s()))',
    )
})

// 32.26 — `{raw(x)}` LOWERS IN AN ATTRIBUTE THE WAY IT DOES IN A TEXT SLOT. Left out of the
// attribute paths, the emitted markup called a bare `raw` no import binds. THE REVERT: drop
// `rawCalls` from `Lowering`'s splice; this reports `__safeUrl(raw(u))` against an import clause
// holding only `escapeAttribute, safeUrl` — a ReferenceError at render.
test('a raw call lowers in an attribute value too', async () => {
    const emitted = await serverOf('<a href={raw(u)}>x</a>', ['u'])
    expect(emitted).toContain('__safeUrl(__slotValue(() => __raw(u())))')
    expect(emitted).toContain('raw as __raw')
})

// A PREFIX `!` DOES NOT END AN OPERAND and a keyword after a `.` is a property name. Read the
// other way each opened a scan that ran to the end of the file, and what came out still parsed as
// a document with nodes silently missing. THE REVERT: let `!` fall to `default` in `tokenise`'s
// `scan`, or drop its `.` test; the sibling element disappears.
test('a slot ends where it reads as ending', () => {
    const bang = parseAbide(
        `<p>{names.filter(n => !/['"]/.test(n)).length}</p><footer>after</footer>`,
    )
    expect(bang.template).toHaveLength(2)
    expect(bang.template[1]).toMatchObject({ kind: 'element', tag: 'footer' })

    const member = parseAbide('<p>{obj.in / 2}</p><em>after</em>')
    expect(member.template).toHaveLength(2)
    expect(member.template[1]).toMatchObject({ kind: 'element', tag: 'em' })

    // A POSTFIX `!` still ends one, which is the case the set was widened for.
    expect(
        parseAbide('<p>{count! / total}</p><em>after</em>').template,
    ).toHaveLength(2)
})

// `{:else}` MOVES BOTH STACKS. Swapping the children stack alone left the level stack naming an
// element the PREVIOUS arm opened, so its close tag popped the arm and everything after it landed
// in the FIRST arm — rendering on the opposite condition. THE REVERT: `stack.pop()` with no
// unwind beside it; `z` below moves to the `a` branch.
test('a close tag inside an else arm does not pop the arm', () => {
    const block = parseAbide('{#if a}<div>x{:else}y</div>z{/if}<p>after</p>')
        .template[0] as { branches: { subject: string; children: unknown[] }[] }
    expect(block.branches.map((branch) => branch.subject)).toEqual(['a', ''])
    expect(block.branches[0]?.children).toHaveLength(1)
    expect(block.branches[1]?.children).toHaveLength(1)
})

// The scanner answers a CONTEXTUAL KEYWORD kind for `type`, `from`, `of`, `as`, … wherever they
// stand, so those declarations never reached `TypeSession` and the page rendered the `Reactive`
// itself. And a declarator list ends at the STATEMENT: `semicolons: "asNeeded"` is the house
// style, so read to the next `;` the list ran into the following `function pair<A, B>` and
// reported its TYPE parameter as a binding. THE REVERT for each is its own test below.
test('a declaration is collected whatever kind the scanner gives its name', async () => {
    expect(
        await declared(
            "let type = reactive('a')\nlet count = reactive(1)\nlet from = reactive(2)",
            ['type', 'count', 'from'],
        ),
    ).toEqual(['count', 'from', 'type'])
})

test('a declarator list ends at the statement, not at the next semicolon', async () => {
    expect(
        await declared(
            'const total = reactive(0)\nfunction pair<A, B>(a: A, b: B) { return [a, b] }',
            ['total'],
        ),
    ).toEqual(['total'])
    // A list that really does continue over a line break still does.
    expect(
        await declared(
            'let a = reactive(0),\n b = reactive(1),\n c = reactive(2)',
            ['a', 'b', 'c'],
        ),
    ).toEqual(['a', 'b', 'c'])
})

// BOTH END TAGS ARE OPTIONAL, and with `</head>` absent the head anchor collapsed onto the body's
// — so the page's `<title>`, `<meta>` and stylesheet links were written after the mount point,
// INSIDE `<body>`. The opening `<body` is the next anchor down and is where the head still ends.
// THE REVERT: `headFound === -1 ? bodyAt : headFound` in `render`; the title below lands after
// `<div id="app">`.
test('a shell with no closing head tag still gets its head content', async () => {
    const { default: Page } = await import(
        `${temporaryModule({ 'Page2.ts': compileFile(PAGE) })}/Page2.ts`
    )
    const shell =
        '<!doctype html><html><body><div id="app"></div></body></html>'
    let out = ''
    for await (const chunk of render(Page, shell))
        out += new TextDecoder().decode(chunk)

    expect(out.indexOf('<title>abide</title>')).toBeLessThan(
        out.indexOf('<body>'),
    )
    expect(out).toContain('<h1 class="title">abide</h1>')
})

// EVERY FRAMEWORK NAME IS BOUND UNDER `__`, the runtime's as much as the escaping. A
// `<script module>` is module scope in the client entry, so an author's `setText` or `Scope` there
// shared a scope with the runtime import made as written. THE REVERT: bind runtime names as written
// in `importClause`; the module then fails to parse with `"setText" has already been declared`.
test("an author's module-scope name cannot collide with a runtime import", async () => {
    const client = await clientOf(
        `<script module>const setText = 1; const Scope = 2</script>
<script>let n = reactive(0)</script>
<p>{n}</p>{#if n}<b>{n}</b>{/if}`,
        ['n'],
    )
    let thrown: unknown
    try {
        new Bun.Transpiler({ loader: 'js' }).transformSync(client)
    } catch (error) {
        thrown = error
    }
    expect(thrown).toBeUndefined()
})

// THE SAME EXCEPTION ON THE SAME GROUNDS, one attribute over. A plain reactive `class={expr}`
// beside a `class:name` is merged by the server and left unbound, because `setAttribute('class',
// …)` replaces the whole token list and takes the directive's name with it — the two bindings
// would then overwrite each other in whichever order they re-ran. No clause spells `class`'s road
// out of it the way 32.20 does `style`'s, so the two share this answer rather than each getting
// its own. THE REVERT: drop the `class` arm of `isMergedPlain`; `__setAttribute` appears here.
test('a class beside a class: directive compiles and is left unbound', async () => {
    const both = await clientOf('<div class={c} class:on={x}>t</div>', [
        'c',
        'x',
    ])
    expect(await refusal(Promise.resolve(both))).toBe('')
    expect(both).toContain('__setClass')
    expect(both).not.toContain('__setAttribute')
    // ALONE IT IS AN ORDINARY BINDING, which is what makes the case above an exception rather
    // than the rule.
    expect(await clientOf('<div class={c}>t</div>', ['c'])).toContain(
        '__setAttribute',
    )
})

// A PLAIN `style={expr}` BESIDE A `style:prop` COMPILES AND IS NOT BOUND, and this pins both
// halves of that. The page RENDERS right \u2014 the server merges the two into one `style` attribute
// \u2014 so refusing it would break a page that works for a clause that is not built; what it costs
// is that this one attribute keeps the value standing at render where 32.3 says it moves.
//
// THE HOLE IS THE POINT OF THE TEST. `style:width` beside it still gets its binding, so the
// assertion is not "nothing is bound here" \u2014 it is that the MERGED one is skipped and the
// property one is not. 32.20 is what closes it, and this test is what fails when it lands.
test('a style beside a style: property compiles and is left unbound \u2014 32.20', async () => {
    const both = await clientOf('<div style={s} style:width={w}>x</div>', [
        's',
        'w',
    ])
    expect(await refusal(Promise.resolve(both))).toBe('')
    // The `style:` half binds through the CSSOM, which is the write that touches one property.
    expect(both).toContain('__setStyleProperty')
    // The merged half gets NO whole-attribute write \u2014 that is the exception.
    expect(both).not.toContain('__setAttribute')
    // ALONE IT IS AN ORDINARY BINDING, which is what makes the case above an exception rather
    // than the rule. THE REVERT: drop the `lowerName === 'style'` skip in `planTemplate`; the
    // first assertion below is unchanged and `__setAttribute` appears in `both` too.
    expect(await clientOf('<div style={s}>x</div>', ['s'])).toContain(
        '__setAttribute',
    )
})

// AN ELEMENT THAT IS BOTH A SHARED PARENT AND A BINDING SITE OF ITS OWN walks to a node an anchor
// is already holding. `hoistPaths`' `nearest` answers only PROPER prefixes, so the element
// carrying a listener AND a bound attribute — the common case 32.3 creates — re-walked one step
// from the anchor above it, once for the listener and once for the attribute.
//
// THE REVERT: drop the exact-match arm from `hoistPaths`' `reference`. Both walks come back as
// `__elementAt(at0, [0])`, which is the anchor's parent plus the step the anchor already took.
test('a bound element reuses the anchor standing at its own path', async () => {
    const client = await clientOf(
        '<section><div onclick={() => { n = n + 1 }} class={tone}><p>{n}</p><p>{tone}</p></div></section>',
        ['n', 'tone'],
    )
    // `at1` IS the `<div>`, hoisted for the two text runs under it.
    expect(client).toContain('at1 = __childAt(at0, [0])')
    // So the listener and the binding read it rather than walking to it again.
    expect(client).toContain('__elementAt(at1, []).addEventListener')
    expect(client).toContain('= __elementAt(at1, [])')
    expect(client).not.toContain('__elementAt(at0, [0])')
})
