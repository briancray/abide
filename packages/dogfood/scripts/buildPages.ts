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

import { readdir, rm, rmdir } from 'node:fs/promises' // bun has no directory remove or listing of its own

import { escapeAttribute } from 'abide'

import { ifPresent } from './ifPresent.ts'
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
import type { Example } from './renderExample.ts'
import { renderInline } from './renderMarkdown.ts'

const ENCODER = new TextEncoder()

const SOURCE = new URL('../src/', import.meta.url)
const PAGES = new URL('ui/pages/', SOURCE)
const PUBLIC = new URL('ui/public/', SOURCE)
const ASSETS = new URL('../assets/', import.meta.url)

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
        footer: footerOf(previous, next),
        rail: railOf(page, body),
    }
    return `// Written by \`scripts/buildPages.ts\` from \`content/${page.slug}.md\`.
import type { DocsContent } from '#shared/DocsContent.ts'

export const CONTENT: DocsContent = ${JSON.stringify(record, null, 4)}
`
}

// THE CHROME EVERY PAGE SHARES, as the one layout around all of them: the skip link, the nav and
// the stylesheet. A layout is not rebuilt between navigations (41.11), so the nav a reader has
// scrolled stays where it is while the page beside it changes — which is why the nav reads where
// it is from the route rather than being told by the page.
//
// `<slot/>` AT THE BODY'S OWN LEVEL, because the body is a three-column grid — nav, `<main>`, rail
// — and the page's `<main>` and rail are its second and third columns. The region anchors round the
// slot are comments, which are not grid items.
const LAYOUT = `<script>
import DocsNav from '#ui/components/DocsNav.abide'
import '#ui/app.css'
</script>

<a class="skip" href="#content">Skip to content</a>
<DocsNav/>
<slot/>
`

// THE PAGE: the head it contributes (39.1), the record beside it, and the BODY AS MARKUP. The body is the one part written into the template rather than carried in the
// record, because an example is a component and a component is a tag — a `{raw}` string cannot
// hold one, and the body cannot be cut around it either, an example sitting inside the `<section>`
// `groupSections` wrapped it in.
//
// HTML WRITTEN INTO A TEMPLATE IS TEMPLATE, so a `{` in a code sample would open a slot. Every
// brace is written as its character reference instead, which the browser reads back as the brace.
//
// `#ui/pages/…` RATHER THAN `./CONTENT.ts`. A relative specifier is left exactly as written and
// the emitted module lives in the build tree, so `./CONTENT.ts` resolves beside the OUTPUT and
// misses the source; an import-map specifier resolves the same from either tree.
export function pageSource(
    page: Page,
    directory: string,
    body: string,
    examples: Example[],
): string {
    const title = escapeAttribute(page.title.replaceAll('`', ''))
    let imports = ''
    // And a newline inside a `<pre>` is written as ITS reference too: the template drops a text
    // node that is only whitespace, and in highlighted code that is every line break, the break
    // sitting between two `<span>`s.
    let markup = body
        .replaceAll('{', '&#123;')
        .replaceAll('}', '&#125;')
        .replace(/<pre\b[\s\S]*?<\/pre>/g, (block) =>
            block.replaceAll('\n', '&#10;'),
        )
    for (const example of examples) {
        imports += `import ${example.component} from '#${example.render.slice('src/'.length)}'\n`
        markup = markup.replace(
            `<!--render:${example.name}-->`,
            () => `<${example.component}/>`,
        )
    }
    return `<script>
import { raw } from 'abide'
import { installDocs } from '#ui/docs.ts'
import { CONTENT } from '#ui/pages/${directory}CONTENT.ts'
${imports}</script>

<head>
    <title>${title} — abide</title>
    <link rel="alternate" type="text/markdown" href="${markdownAddressOf(page.slug)}" title="${title} as Markdown">
</head>

<main id="content" bind:element={installDocs}>
    <header>{raw(CONTENT.header)}</header>
    ${markup}
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
                ? ENCODER.encode(contents)
                : contents instanceof Uint8Array
                  ? contents
                  : new Uint8Array(await contents.arrayBuffer())
        const held = await ifPresent(existing.bytes())
        if (
            held !== undefined &&
            held.length === next.length &&
            sameBytes(held, next)
        )
            return
        await Bun.write(at, next)
    }

    await put(new URL('ui/NAV_ITEMS.ts', SOURCE), navItems(pages))
    await put(new URL('layout.abide', PAGES), LAYOUT)

    const markdown: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index] as Page
        const directory = directoryOf(page.slug)
        const { body, examples } = await renderBody(page, pages)
        await put(
            new URL(`${directory}page.abide`, PAGES),
            pageSource(page, directory, body, examples),
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
    // AND THE DIRECTORIES THAT LEAVES EMPTY, deepest first so a parent is asked after its
    // children went. Under `pages/` an empty directory is harmless; under `public/` it is a folder
    // the app serves a listing-shaped nothing from, and the zips' left one standing.
    const directories = [
        ...new Bun.Glob('**/*').scanSync({
            cwd: root.pathname,
            onlyFiles: false,
        }),
    ]
        .map((name) => new URL(name, root).pathname)
        .sort((a, b) => b.length - a.length)
    for (const path of directories)
        if (
            !written.has(path) &&
            (await readdir(path).catch(() => null))?.length === 0
        )
            await rmdir(path)
}

if (import.meta.main) {
    const pages = await buildPages()
    const written = pages.filter((page) => !page.stub).length
    console.log(
        `docs: ${pages.length} pages -> src/ui/pages (${written} written, ${pages.length - written} stubs), plus markdown and abide.md under src/ui/public`,
    )
}
