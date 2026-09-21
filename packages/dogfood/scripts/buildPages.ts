#!/usr/bin/env bun

// THE DOCUMENTATION, COMPILED INTO THE APP. `content/**.md` is the source and `src/ui/pages/**`
// is what abide serves, so this is the one step between them: a page's body is rendered here and
// the `.abide` that carries it is written here, and from there it is an ordinary abide app —
// `abide build`, `abide start`, `abide dev`, the same three commands an app author runs.
//
// WHY A GENERATOR AT ALL. A page reads its own markdown at RENDER time in the design (16.x's
// handlers, a loader on the server seam), and none of that surface is built — what exists today
// is a `<script>` that runs on both sides, so a page that read the file system would put the
// file system in the browser bundle. Compiling the content IN is the honest shape until then,
// and it is also what a docs site wants: nothing to read per request.
//
// IT OWNS TWO DIRECTORIES WHOLE. `src/ui/pages` and `src/ui/public` are this script's output and
// nothing else writes there, so a renamed page cannot leave its old address answering — which is
// why the files an author DID write by hand (`assets/`) live outside them and are copied in.
//
// AND IT REWRITES ONLY WHAT CHANGED. Emptying the two directories first was the obvious way to
// get that and it is unusable under `abide dev`: the watcher sees 250 deletions and 250 writes
// for one word, rebuilds the app on each burst, and compiles a tree that is half there — the
// checker's own listing panicked on a directory that vanished between the glob and the ask. So
// every file is compared before it is written and what is left over is deleted at the end, and
// one word changes one page.

import { rm } from 'node:fs/promises' // bun has no recursive directory remove of its own

import { buildInjectable } from '../../harness/scripts/buildInjectable.ts'
import {
    headingsOf,
    markdownAddressOf,
    type Page,
    readPages,
    renderBody,
    renderBundle,
    renderPageMarkdown,
    routeOf,
} from './readContent.ts'
import { escapeHtml, renderInline } from './renderMarkdown.ts'
import { type ZipEntry, zip } from './zip.ts'

const SOURCE = new URL('../src/', import.meta.url)
const PAGES = new URL('ui/pages/', SOURCE)
const PUBLIC = new URL('ui/public/', SOURCE)
const ASSETS = new URL('../assets/', import.meta.url)
const EXAMPLES = new URL('../examples/', import.meta.url)

// A page's DIRECTORY under `pages/`, which is the whole of its address (CLAUDE.md): the app's
// root page is `pages/page.abide` and a section's overview is the section's own directory.
export function directoryOf(slug: string): string {
    const route = routeOf(slug)
    return route === '/' ? '' : `${route.slice(1)}/`
}

// The nav is ONE module for the whole app rather than markup generated into every page: it is
// the same list on all eighty of them, and a copy per page is that list in every route chunk a
// reader loads. `DocsNav.abide` is the only reader.
function navItems(pages: Page[]): string {
    const groups: string[] = []
    let section = ''
    let items: string[] = []
    const close = (): void => {
        if (section === '') return
        groups.push(
            `    {\n        section: ${JSON.stringify(section)},\n        pages: [\n${items.join('\n')}\n        ],\n    },`,
        )
    }
    for (const page of pages) {
        if (page.section !== section) {
            close()
            section = page.section
            items = []
        }
        items.push(
            `            { slug: ${JSON.stringify(page.slug)}, href: ${JSON.stringify(routeOf(page.slug))}, nav: ${JSON.stringify(renderInline(page.nav))}, stub: ${page.stub} },`,
        )
    }
    close()
    return `// Written by \`scripts/buildPages.ts\` from the front matter under \`content/\`. The ORDER and the
// GROUPING are \`scripts/NAV.ts\`; the label and the stub mark are each page's own.

export type NavItem = { slug: string; href: string; nav: string; stub: boolean }
export type NavGroup = { section: string; pages: NavItem[] }

export const NAV_ITEMS: NavGroup[] = [
${groups.join('\n')}
]
`
}

// The page's opening: the stub notice where there is one, the title, and the intent under it.
function headerOf(page: Page): string {
    const notice = page.stub
        ? '<p class="notice">Stub — title and intent decided, prose not written.</p>'
        : ''
    const intent =
        page.intent === ''
            ? ''
            : `<p class="intent">${renderInline(page.intent)}</p>`
    return `${notice}<h1>${renderInline(page.title)}</h1>${intent}`
}

// Reading order, as two links. The nav is the whole set and this is the thread through it.
function footerOf(previous: Page | undefined, next: Page | undefined): string {
    let footer = ''
    if (previous !== undefined)
        footer += `<a href="${routeOf(previous.slug)}">&larr; ${renderInline(previous.nav)}</a>`
    if (next !== undefined)
        footer += `<a class="next" href="${routeOf(next.slug)}">${renderInline(next.nav)} &rarr;</a>`
    return footer
}

// The rail is where a reader is already looking for "what else is here", so the markdown
// downloads sit under the heading list rather than in the nav. It renders on EVERY page: a page
// with one heading has no table of contents (`headingsOf`) and still has its downloads.
export function railOf(page: Page, body: string): string {
    let items = ''
    for (const heading of headingsOf(body))
        items += `<li class="lvl-${heading.level}"><a href="#${heading.id}">${heading.label}</a></li>`
    const contents =
        items === ''
            ? ''
            : `<section><h2 id="toc-title">On this page</h2><ul aria-labelledby="toc-title">${items}</ul></section>`
    return `<aside class="toc">${contents}<section><h2 id="md-title">Markdown</h2>
<ul class="downloads" aria-labelledby="md-title">
<li><a href="${markdownAddressOf(page.slug)}" download>Download this page</a></li>
<li><a href="/abide.md" download>Download full docs</a></li>
</ul></section></aside>`
}

// The page, as the app holds it. A record in a module of its own rather than markup in the
// `.abide`: the body is HTML the markdown renderer produced, and HTML written into a template is
// TEMPLATE — a `{` in a code sample opens a slot — so it crosses as a string and the page
// renders it through `raw` (32.25). `DocsContent` says why every field is one.
function contentModule(
    page: Page,
    body: string,
    previous: Page | undefined,
    next: Page | undefined,
): string {
    const record = {
        slug: page.slug,
        header: headerOf(page),
        body,
        footer: footerOf(previous, next),
        rail: railOf(page, body),
    }
    return `// Written by \`scripts/buildPages.ts\` from \`content/${page.slug}.md\`.
import type { DocsContent } from '#shared/DocsContent.ts'

export const CONTENT: DocsContent = ${JSON.stringify(record, null, 4)}
`
}

// THE PAGE, AND IT IS THE SAME PAGE EIGHTY-FIVE TIMES: the head it contributes (39.1), the nav
// every page shares, and five slots over the record beside it. What differs is the record, which
// is why the record is the import.
//
// `#ui/pages/…` RATHER THAN `./CONTENT.ts`. A relative specifier is left exactly as written and
// the emitted module lives in the build tree, so `./CONTENT.ts` resolves beside the OUTPUT and
// misses the source; an import-map specifier resolves the same from either tree.
export function pageSource(page: Page, directory: string): string {
    const title = escapeHtml(page.title.replaceAll('`', ''))
    return `<script>
import { raw } from 'abide'
import DocsNav from '#ui/components/DocsNav.abide'
import { CONTENT } from '#ui/pages/${directory}CONTENT.ts'
import '#ui/app.css'
</script>

<head>
    <title>${title} — abide</title>
    <link rel="alternate" type="text/markdown" href="${markdownAddressOf(page.slug)}" title="${title} as Markdown">
</head>

<a class="skip" href="#content">Skip to content</a>
<DocsNav current={CONTENT.slug}/>
<main id="content">
    <header>{raw(CONTENT.header)}</header>
    {raw(CONTENT.body)}
    <footer>{raw(CONTENT.footer)}</footer>
</main>
{raw(CONTENT.rail)}
`
}

export async function buildPages(): Promise<Page[]> {
    const pages = await readPages()
    const written = new Set<string>()

    // ONE WRITE PER FILE THAT MOVED. The path is remembered either way, which is what `prune`
    // reads to know what the last run left behind.
    async function put(
        at: URL,
        contents: string | Uint8Array | Bun.BunFile,
    ): Promise<void> {
        written.add(at.pathname)
        const existing = Bun.file(at)
        const next =
            typeof contents === 'string'
                ? new TextEncoder().encode(contents)
                : contents instanceof Uint8Array
                  ? contents
                  : new Uint8Array(await contents.arrayBuffer())
        if (await existing.exists()) {
            const held = new Uint8Array(await existing.arrayBuffer())
            if (held.length === next.length && sameBytes(held, next)) return
        }
        await Bun.write(at, next)
    }

    await put(new URL('ui/NAV_ITEMS.ts', SOURCE), navItems(pages))

    const markdown: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index] as Page
        const directory = directoryOf(page.slug)
        const body = await renderBody(page, pages)
        await put(
            new URL(`${directory}page.abide`, PAGES),
            pageSource(page, directory),
        )
        await put(
            new URL(`${directory}CONTENT.ts`, PAGES),
            contentModule(page, body, pages[index - 1], pages[index + 1]),
        )
        // The RENDERED page, not a copy of the content file. The copy was byte-identical to the
        // repo file, which is the same thing as the page only while the page carries no
        // directive — a section overview is `{% lead %}` markers and little else, so the
        // download was the markers.
        markdown[index] = await renderPageMarkdown(page, pages)
        await put(new URL(`${page.slug}.md`, PUBLIC), markdown[index] as string)
    }

    // ONE FILE in reading order, for an agent that would otherwise fetch eighty.
    await put(new URL('abide.md', PUBLIC), renderBundle(pages, markdown))

    // THE MEASURE LANE, AS ONE FILE, fetched once by a card's panel and only when a reader opens
    // one — 40.18. Inlining it would put 20 kB into every example's `srcdoc` attribute.
    await put(new URL('measure.js', PUBLIC), Bun.file(await buildInjectable()))

    // ONE ZIP PER EXAMPLE, so Download is a button rather than a menu. Entries carry the example
    // name as their first segment, so unzipping makes a folder.
    const archives = new Map<string, ZipEntry[]>()
    for (const path of new Bun.Glob(
        '*/{files,compiled,vanilla,tests}/**',
    ).scanSync({ cwd: EXAMPLES.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        const entries = archives.get(name) ?? []
        entries.push({
            path,
            source: await Bun.file(new URL(path, EXAMPLES)).text(),
        })
        archives.set(name, entries)
    }
    for (const [name, entries] of archives) {
        entries.sort((a, b) => (a.path < b.path ? -1 : 1))
        await put(new URL(`examples/${name}.zip`, PUBLIC), zip(entries))
    }

    // What an author wrote by hand, into the directory a generator owns.
    for (const name of new Bun.Glob('**/*').scanSync({ cwd: ASSETS.pathname }))
        await put(new URL(name, PUBLIC), Bun.file(new URL(name, ASSETS)))

    await prune(PAGES, written)
    await prune(PUBLIC, written)
    return pages
}

function sameBytes(held: Uint8Array, next: Uint8Array): boolean {
    for (let at = 0; at < held.length; at += 1)
        if (held[at] !== next[at]) return false
    return true
}

// WHAT THIS RUN DID NOT WRITE. A page renamed in `NAV.ts` leaves a directory behind, and a
// directory under `pages/` is an ADDRESS — so what is left over is not stale output, it is a
// page the app goes on serving.
async function prune(root: URL, written: Set<string>): Promise<void> {
    for (const name of new Bun.Glob('**/*').scanSync({
        cwd: root.pathname,
        onlyFiles: true,
    })) {
        const path = new URL(name, root).pathname
        if (!written.has(path)) await rm(path)
    }
}

if (import.meta.main) {
    const pages = await buildPages()
    const written = pages.filter((page) => !page.stub).length
    console.log(
        `docs: ${pages.length} pages -> src/ui/pages (${written} written, ${pages.length - written} stubs), plus markdown, zips and abide.md under src/ui/public`,
    )
}
