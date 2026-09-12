// THE SERVED SCRIPT IS OPAQUE TO THE COMPILER. It is a template literal, so
// typescript checks that the LITERAL is well formed and nothing at all about the
// JavaScript inside it — and a page whose script does not parse looks completely
// normal and does nothing.
//
// Six escaping mistakes have now gone through a seam of this shape, five of them a
// backtick inside a comment inside the literal. `checkInlineScripts` gates the docs
// page's own script at build; this gates the status page's.

import { expect, test } from 'bun:test'
import { STATUS_ENDPOINTS } from '../scripts/STATUS_ENDPOINTS.ts'

// One page, built here rather than read off disk: what this file gates is the SHELL,
// and reading 88 content files to check a `<nav>` would make it a test about them.
const PAGES: Page[] = [
    {
        slug: 'start/index',
        section: 'Getting started',
        title: 'Start',
        nav: 'Getting started',
        intent: '',
        covers: [],
        examples: [],
        enumerates: [],
        stub: false,
        body: '',
    } as Page,
]

import { type Page, renderStatusPage } from '../scripts/buildDocs.ts'
import { STATUS_PAGE } from '../scripts/STATUS_PAGE.ts'
import { STATUS_SCRIPT } from '../scripts/STATUS_SCRIPT.ts'

// Reverted — drop the parse — a stray backtick ships and the page renders its shell,
// wires up no buttons, and reports nothing anywhere.
test('the status page script parses', () => {
    expect(() => new Function(STATUS_SCRIPT)).not.toThrow()
})

// THE RENDERED PAGE, not the fragment. The script tag and the sidebar are composed by
// `renderStatusPage`, so a test over `STATUS_PAGE` alone would pass while the page
// shipped no script at all — which is exactly what happened when the shell moved out
// of the fragment and into the renderer.
test('the rendered page ships no inline script and carries the sidebar', () => {
    const html = renderStatusPage(PAGES)
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inline).toEqual([])
    expect(html).toContain('<script src="status.js">')
    // 40.45 — reachable from the documentation's own navigation. The link is rendered
    // beside `NAV` rather than listed in it, so this is the only thing that says the
    // page a reader arrives on can be left again.
    expect(html).toContain('<a class="brand" href="index.html">')
    expect(html).toContain('>Getting started<')
    expect(html).toContain('<h2>Build</h2>')
    expect(html).toContain('href="status.html" aria-current="page"')
})

test('the page asks for every endpoint the server answers, and no other', () => {
    for (const endpoint of STATUS_ENDPOINTS)
        expect(STATUS_SCRIPT).toContain(endpoint)
    // The direction that ships silently. A page renaming an endpoint leaves the
    // server offering the old one and the panel fetching a 404, and the check that
    // only runs server-to-page cannot see it.
    const asked = [...STATUS_SCRIPT.matchAll(/'(\/api\/[\w/]+)'/g)].map(
        (match) => match[1],
    )
    expect([...new Set(asked)].sort()).toEqual([...STATUS_ENDPOINTS].sort())
})

// THE PAGE SHARES THE DOCS STYLESHEET, which is the whole reason it looks like the
// rest of the site and the whole reason a class name is a collision waiting to
// happen. `app.css` carries a `.row` that is `display: flex`; a table row marked
// `class="row"` stopped being a table row, every cell became a block, and the six
// columns wrapped to their own widths on every line. It renders as a table with the
// columns slightly wrong, which is the worst way for a layout bug to present — it
// looks like a spacing problem, not a structural one.
//
// Reverted — drop the `st-` prefix from one class the stylesheet also names — and
// this fails.
test('every class the status page introduces is prefixed and collides with nothing', async () => {
    const css = await Bun.file(
        new URL('../src/ui/app.css', import.meta.url),
    ).text()
    const shared = new Set(
        [...css.matchAll(/(?:^|[\s,>])\.([a-zA-Z][\w-]*)/gm)].map(
            (match) => match[1] ?? '',
        ),
    )
    // Both halves: what the page STYLES, and what the script WRITES.
    const introduced = new Set<string>()
    // COMMENTS ARE STRIPPED FIRST. A selector-shaped word in a CSS comment is not a
    // selector, and the rule explaining the `.row` collision named it — so the check
    // failed on the sentence describing the bug it exists to catch.
    const style = STATUS_PAGE.slice(
        STATUS_PAGE.indexOf('<style>'),
        STATUS_PAGE.indexOf('</style>'),
    ).replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const match of style.matchAll(/\.([a-zA-Z][\w-]*)/g))
        introduced.add(match[1] ?? '')
    for (const match of STATUS_SCRIPT.matchAll(/class="([^"'+]+)"/g))
        for (const name of (match[1] ?? '').split(/\s+/)) introduced.add(name)
    // A COMPUTED CLASS IS STILL A CLASS. The literal scan above stops at a `+`, so
    // `class="' + (failed ? 'st-no' : 'ok') + '"` was invisible to it — and `ok` sat
    // there unprefixed and unstyled through two rounds of edits. So any LINE that
    // assigns a class collects every quoted word on it. That over-collects — `queued`
    // and `running` are words, not classes — and over-collecting is the safe
    // direction: the question asked is whether a collected word collides with the
    // shared stylesheet, and a word that never reaches an attribute cannot.
    for (const line of STATUS_SCRIPT.split('\n')) {
        if (!/class="|tone = |klass = /.test(line)) continue
        for (const match of line.matchAll(/'([a-z][\w-]*)'/g))
            introduced.add(match[1] ?? '')
    }

    // `ex-` classes are the documentation's own and are BORROWED on purpose — a tag
    // and a note look the same here as they do on a card.
    const collisions = [...introduced].filter(
        (name) => !name.startsWith('ex-') && shared.has(name),
    )
    expect(collisions).toEqual([])
})
