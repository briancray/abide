// WHAT THE DOCS APP SERVES, read off the app itself: each page's document and its markdown twin, and
// the bundle of all of them. A page is written once, as `index.abide`, and everything here is derived
// from it at run time — so what is gated is the derivation, which fails silently: the page still
// renders and the twin still reads.

import { beforeAll, expect, test } from 'bun:test'

import { withoutExcerpt } from '../src/lib/highlight.ts'
import { PAGES } from '../src/lib/sitePages.ts'
import {
    renderedHtml,
    renderedMarkdown,
    servedDocs,
    written,
} from './docsPages.ts'

// EVERY PAGE, LOADED ONCE AHEAD OF THE TESTS: under the parallel gate the first test to ask would pay
// for the whole load against the other suites, inside its own five seconds.
beforeAll(() => Promise.all([renderedMarkdown(), renderedHtml()]), 60_000)

/** Every route the site has: its pages, and the rulebook a page links each clause it cites into (40.11). */
function routes(): Set<string> {
    const listed = new Set<string>(['/rulebook'])
    for (const page of PAGES) listed.add(page.route)
    return listed
}

// A region rendered twice shows on the one thing it cannot hide: a heading appearing twice.
test('no page ships a section twice', async () => {
    const doubled: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const seen = new Set<string>()
        for (const line of body.split('\n')) {
            if (!line.startsWith('## ')) continue
            if (seen.has(line)) doubled.push(`${route}: ${line}`)
            seen.add(line)
        }
    }
    expect(doubled).toEqual([])
})

// A twin is read where it lies, so a link in it names another twin — a dead one is a page the
// reader who downloaded the docs cannot follow.
test('every internal link in a markdown twin names a page that exists', async () => {
    const listed = routes()
    const broken: string[] = []
    for (const [route, body] of await renderedMarkdown())
        // A link spelled inside a fence is code, not a link.
        for (const [, target] of body
            .replaceAll(/```[\s\S]*?```/g, '')
            .matchAll(/\]\((\/[^)#]*)(?:#[^)]*)?\)/g)) {
            const page = (target as string).replace(/\.md$/, '')
            if (!listed.has(page === '/index' ? '/' : page))
                broken.push(`${route}: ${target}`)
        }
    expect(broken).toEqual([])
})

test('the bundle carries every page, in reading order', async () => {
    const { base } = await servedDocs()
    const bundle = await (await Bun.fetch(`${base}/abide.md`)).text()
    const markers = [...bundle.matchAll(/^<!-- (\S+\.md) -->$/gm)].map(
        (match) => match[1],
    )
    const expected: string[] = []
    for (const page of PAGES)
        expected.push(
            page.route === '/' ? 'index.md' : `${page.route.slice(1)}.md`,
        )
    expect(markers).toEqual(expected)
})

// The rail carries the downloads on EVERY page, and the head names the twin as an alternate.
test('every page offers its own markdown and the bundle', async () => {
    const missing: string[] = []
    for (const [route, document] of await renderedHtml()) {
        const twin = route === '/' ? '/index.md' : `${route}.md`
        if (!document.includes(`<a href="${twin}" download>`))
            missing.push(`${route}: page`)
        if (!document.includes('<a href="/abide.md" download>'))
            missing.push(`${route}: bundle`)
        if (
            !document.includes(
                `<link rel="alternate" type="text/markdown" href="${twin}"`,
            )
        )
            missing.push(`${route}: alternate`)
    }
    expect(missing).toEqual([])
})

// A link in a page's prose is an address the app answers: a page, an anchor, or what a handler or a
// public file answers at — the last two asked of the app itself.
test('a page links to an address the app answers', async () => {
    const listed = routes()
    const { base } = await servedDocs()
    const broken: string[] = []
    for (const [route, document] of await renderedHtml()) {
        const main = document.slice(
            document.indexOf('<main'),
            document.indexOf('</main>'),
        )
        for (const [, target] of main.matchAll(
            /href="(\/[^"#]*)(?:#[^"]*)?"/g,
        )) {
            const address = (target as string).replaceAll('&amp;', '&')
            if (listed.has(address.split('?')[0] as string)) continue
            const answer = await Bun.fetch(`${base}${address}`, {
                redirect: 'manual',
            })
            await answer.body?.cancel()
            if (answer.status >= 400)
                broken.push(`${route}: ${address} ${answer.status}`)
        }
    }
    expect(broken).toEqual([])
})

// A `**` or a `](` reaching the HTML is markdown a page carried as text, and the page shows its
// asterisks and brackets while every gate on the markdown passes.
test('no page ships markdown it did not render', async () => {
    const literal: string[] = []
    for (const [route, document] of await renderedHtml()) {
        const prose = document
            .slice(document.indexOf('<main'), document.indexOf('</main>'))
            .replace(/<pre[\s\S]*?<\/pre>/g, '')
            .replace(/<code[\s\S]*?<\/code>/g, '')
            // a field's value is what someone typed, markdown included, not the page's prose
            .replace(/<textarea[\s\S]*?<\/textarea>/g, '')
        if (prose.includes('**')) literal.push(`${route}: emphasis`)
        if (prose.includes('](')) literal.push(`${route}: link`)
    }
    expect(literal).toEqual([])
})

// A row whose header declares three columns has three cells: a union type's `|` in a cell is the
// one way to shunt every cell after it one column right with nothing failing.
test('a table row has as many cells as its header declares', async () => {
    const ragged: string[] = []
    for (const [route, document] of await renderedHtml())
        for (const table of document.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
            const body = table[1] ?? ''
            const columns = (body.match(/<th>/g) ?? []).length
            if (!columns) continue
            for (const row of body.matchAll(
                /<tr>((?:<td>[\s\S]*?<\/td>)+)<\/tr>/g,
            )) {
                const cells = (row[1]?.match(/<td>/g) ?? []).length
                if (cells !== columns)
                    ragged.push(
                        `${route}: ${cells} cells under ${columns} columns`,
                    )
            }
        }
    expect(ragged).toEqual([])
})

// A CAPTION NAMES THE SYNTAX: a file, or a language beside the side it runs on. `browser` alone
// leaves a reader guessing between a name read by name in a `.abide` and `s()` in a `.ts`.
test('every code caption names a syntax or a file', async () => {
    const vague: string[] = []
    for (const [route, document] of await renderedHtml())
        for (const [, text] of document.matchAll(
            /<figcaption>([^<]*)<\/figcaption>/g,
        )) {
            const caption = withoutExcerpt(text as string)
            if (caption.startsWith('.') || /\.\w+$/.test(caption)) continue
            vague.push(`${route}: "${text}"`)
        }
    expect([...new Set(vague)]).toEqual([])
})

// 40.31 — AN EXAMPLE THAT RUNS IS MOUNTED UNDER ITS FENCE, and its twin is the fence alone: the chart
// the first example of `/headless/chart` draws is in the page, and none of its tick labels is in
// the twin. THE REVERT: drop the `data-result` skip from `markdownOf`, and `$40K` is in the twin.
test("an example's file is mounted under its fence, and only the fence is in the twin", async () => {
    const page = (await renderedHtml()).get('/headless/chart') ?? ''
    const twin = written(
        (await renderedMarkdown()).get('/headless/chart') ?? '',
    )
    expect(page).toMatch(
        /data-result[^>]*>(?:<!--[^>]*-->)*<svg[^>]*aria-label="Won revenue against target"/,
    )
    expect(twin).toContain('    x: MONTHS,')
    expect(twin).not.toContain('$40K')
})
