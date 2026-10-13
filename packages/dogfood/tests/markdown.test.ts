// WHAT THE DOCS APP SERVES, read off the app itself: each page's document and its markdown twin, and
// the bundle of all of them. A page is written once, as `index.abide`, and everything here is derived
// from it at run time — so what is gated is the derivation, which fails silently: the page still
// renders and the twin still reads.

import { expect, test } from 'bun:test'
import { SITE } from '../src/lib/SITE.ts'
import {
    allCards,
    cardsOf,
    docsPages,
    renderedHtml,
    renderedMarkdown,
    servedDocs,
} from './docsPages.ts'

/** Every route `SITE` lists. */
function routes(): Set<string> {
    const listed = new Set<string>()
    for (const group of SITE)
        for (const page of group.pages) listed.add(page.route)
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
        for (const [, target] of body.matchAll(
            /\]\((\/[^)#]*)(?:#[^)]*)?\)/g,
        )) {
            const page = (target as string).replace(/\.md$/, '')
            if (!listed.has(page === '/index' ? '/' : page))
                broken.push(`${route}: ${target}`)
        }
    expect(broken).toEqual([])
})

// An example's files are the answer to the page's problem, and a card that renders in HTML and
// vanishes from the markdown is the silent half of this.
test('every card brings its files into the markdown', async () => {
    const bodies = await renderedMarkdown()
    const missing: string[] = []
    for (const card of await allCards())
        for (const shown of card.files.keys())
            if (
                !new RegExp(`^\`\`\`\\S* ${RegExp.escape(shown)}$`, 'm').test(
                    bodies.get(card.route) ?? '',
                )
            )
                missing.push(`${card.route}: ${card.id} ${shown}`)
    expect(missing).toEqual([])
})

// A card renders ONE component, invoked inside it once.
test('every card invokes the component it renders, once', async () => {
    const wrong: string[] = []
    for (const page of await docsPages())
        for (const card of cardsOf(page)) {
            const tag = /\/(\w+)\.abide$/.exec(card.component)?.[1]
            const invoked =
                tag === undefined
                    ? 0
                    : (
                          page.source.match(
                              new RegExp(`<${tag}[\\s/>]`, 'g'),
                          ) ?? []
                      ).length
            if (invoked !== 1)
                wrong.push(
                    `${page.route}: ${card.id} invokes ${tag} ${invoked} times`,
                )
        }
    expect(wrong).toEqual([])
})

test('the bundle carries every page, in reading order', async () => {
    const { base } = await servedDocs()
    const bundle = await (await Bun.fetch(`${base}/abide.md`)).text()
    const markers = [...bundle.matchAll(/^<!-- (\S+\.md) -->$/gm)].map(
        (match) => match[1],
    )
    const expected: string[] = []
    for (const group of SITE)
        for (const page of group.pages)
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

// A cell opening on `yes` / `no` renders as a verdict and a recessive reason — and a SENTENCE that
// begins with the word does not. Both directions, because loosening the pattern breaks only one.
test('a verdict cell is marked up, and a sentence that opens on one is not', async () => {
    const pages = await renderedHtml()
    const holds = pages.get('/values/show-a-value-that-isnt-there-yet') ?? ''
    expect(holds).toContain('<b class="verdict-no">no</b>')
    expect(holds).toContain('<b class="verdict-yes">yes</b>')
    expect(pages.get('/data/refuse-a-request-and-say-why')).toContain(
        '<td>no route matched',
    )
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
            .replace(
                /<div class="ex-render">[\s\S]*?<div class="ex-files"/g,
                '',
            )
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
            const caption = (text as string).replace(/ — excerpt$/, '')
            if (caption.startsWith('.') || /\.\w+$/.test(caption)) continue
            vague.push(`${route}: "${text}"`)
        }
    expect([...new Set(vague)]).toEqual([])
})
