#!/usr/bin/env bun

// Renders `content/**.md` into `dist/**.html` against the order in NAV, COPIES each content
// file beside its page, and concatenates the set into `dist/abide.md`.
//
// SCAFFOLDING, and deliberately so: it exists to make the documentation READABLE
// while the words are still being decided, and it is deleted once `abide build` can
// serve these pages itself. The styling below is a reading column and nothing more —
// the design is a later pass, and anything that looks designed here would be judged
// as a design decision it is not.

import { rm } from 'node:fs/promises' // bun has no recursive directory remove of its own
import { NAV } from './NAV.ts'
import { exampleMarkdown, readExample } from './renderExample.ts'
import { EXAMPLE, LEAD, renderInline, renderMarkdown } from './renderMarkdown.ts'
import { type ZipEntry, zip } from './zip.ts'

const CONTENT_DIR = new URL('../content/', import.meta.url)
const OUTPUT_DIR = new URL('../dist/', import.meta.url)

type Page = {
    slug: string
    section: string
    title: string
    nav: string
    intent: string
    covers: string[]
    // The example DIRECTORIES this page embeds, repo-relative. Front matter rather than
    // convention, so an agent reading the markdown alone knows where the files are without
    // being told how `{% example name %}` resolves.
    examples: string[]
    stub: boolean
    body: string
}

// Front matter is `key: value` lines between two `---` rules, plus a `- item` list
// form. The list form is not decoration: a capability name may contain a comma, a
// colon or a pipe, so no single-line delimiter is safe for `covers`.
function readFrontMatter(source: string): { fields: Map<string, string[]>; body: string } {
    const fields = new Map<string, string[]>()
    if (!source.startsWith('---\n')) return { fields, body: source }
    const end = source.indexOf('\n---', 4)
    if (end === -1) return { fields, body: source }

    let current: string[] | undefined
    for (const line of source.slice(4, end).split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ')) {
            current?.push(trimmed.slice(2).trim())
            continue
        }
        const separator = line.indexOf(':')
        if (separator === -1) continue
        const value = line.slice(separator + 1).trim()
        current = value ? [value] : []
        fields.set(line.slice(0, separator).trim(), current)
    }
    return { fields, body: source.slice(source.indexOf('\n', end + 1) + 1) }
}

export async function readPages(): Promise<Page[]> {
    const pages: Page[] = []
    for (const group of NAV) {
        for (const slug of group.pages) {
            const file = Bun.file(new URL(`${slug}.md`, CONTENT_DIR))
            if (!(await file.exists()))
                throw new Error(`buildDocs: NAV names ${slug}, content/${slug}.md is missing`)
            const { fields, body } = readFrontMatter(await file.text())
            pages.push({
                slug,
                section: group.section,
                title: fields.get('title')?.[0] ?? slug,
                nav: fields.get('nav')?.[0] ?? fields.get('title')?.[0] ?? slug,
                intent: fields.get('intent')?.[0] ?? '',
                covers: fields.get('covers') ?? [],
                examples: fields.get('examples') ?? [],
                stub: fields.get('status')?.[0] === 'stub',
                body,
            })
        }
    }
    return pages
}

// Every href is RELATIVE to the page it sits on, so `dist/index.html` opens over
// file:// with no server in front of it.
function linkTo(from: string, to: string): string {
    const depth = from.split('/').length - 1
    return `${'../'.repeat(depth)}${to}.html`
}

function basename(slug: string): string {
    return slug.slice(slug.lastIndexOf('/') + 1)
}

function renderNav(pages: Page[], current: string): string {
    let html = ''
    let section = ''
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        if (page.section !== section) {
            if (section) html += '</ul>'
            section = page.section
            html += `<h2>${section}</h2><ul>`
        }
        const here = page.slug === current ? ' aria-current="page"' : ''
        const stub = page.stub ? '<span class="stub" title="Stub — not written yet"></span>' : ''
        html += `<li><a href="${linkTo(current, page.slug)}"${here}>${renderInline(page.nav)}</a>${stub}</li>`
    }
    return section ? `${html}</ul>` : html
}

// The heading list is read off the RENDERED body rather than the markdown, so a heading's
// link text is the same inline HTML the heading itself got — a `code` span included.
function renderHeadingList(body: string): string {
    const pattern = /<h([23]) id="([^"]+)">(.*?)<\/h\1>/g
    let items = ''
    let count = 0
    for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
        count += 1
        items += `<li class="lvl-${match[1]}"><a href="#${match[2]}">${match[3]}</a></li>`
    }
    // One heading is not a table of contents, it is a repeat of the title.
    return count < 2 ? '' : items
}

// The rail is where a reader is already looking for "what else is here", so the markdown
// downloads sit under the heading list rather than in the nav. It renders on EVERY page:
// a page with one heading has no table of contents and still has a download.
function renderRail(headings: string, markdownName: string, root: string): string {
    const contents = headings
        ? `<h2 id="toc-title">On this page</h2><ul aria-labelledby="toc-title">${headings}</ul>`
        : ''
    return `<aside class="toc">${contents}<h2 id="md-title">Markdown</h2>
<ul class="downloads" aria-labelledby="md-title">
<li><a href="${markdownName}" download>Download this page</a></li>
<li><a href="${root}abide.md" download>Download full docs</a></li>
</ul></aside>`
}

// Scroll-spy. Offsets are MEASURED ONCE — on load, on resize, and after the webfonts
// swap, which is itself a reflow — so the scroll handler is arithmetic with no layout
// read in it. An IntersectionObserver band was tried first and got two cases wrong:
// nothing was active at the top, and the last sections never activated because at max
// scroll they never enter the band.
const SCROLL_SPY = `
const headings = [...document.querySelectorAll('main h2[id], main h3[id]')]
const links = headings.map((h) => document.querySelector('.toc a[href="#' + h.id + '"]'))
let offsets = []
let current = -1

function measure() {
  offsets = headings.map((h) => h.getBoundingClientRect().top + window.scrollY)
  update()
}

function update() {
  const line = window.scrollY + 80
  let next = 0
  for (let i = 0; i < offsets.length; i += 1) if (offsets[i] <= line) next = i
  // At the bottom there is no room left to scroll the last heading up to the line.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
    next = offsets.length - 1
  }
  if (next === current) return
  links[current]?.removeAttribute('aria-current')
  links[next]?.setAttribute('aria-current', 'true')
  current = next
}

let queued = false
addEventListener('scroll', () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => { queued = false; update() })
}, { passive: true })
addEventListener('resize', measure, { passive: true })
document.fonts?.ready.then(measure)
measure()
`

// Panel tabs and file tabs are the same interaction, so one delegated listener per
// example serves both rather than a listener per button. The result's REPLAY rides
// along: opening the Result tab replays from the first state, which is the only way
// a transient one — `pending()` — is ever visible.
const EXAMPLE_TABS = `
for (const example of document.querySelectorAll('.example')) {
  const browser = example.querySelector('.ex-browser')
  const frame = browser?.querySelector('.ex-result')
  const states = browser ? JSON.parse(browser.querySelector('[data-states]').textContent) : []
  let timer

  function play(index) {
    clearTimeout(timer)
    const state = states[index]
    if (!state || !frame) return
    frame.srcdoc = state.html
    if (state.hold && index < states.length - 1) timer = setTimeout(() => play(index + 1), state.hold)
  }
  if (states.length > 1) play(states.length - 1)

  example.addEventListener('click', (event) => {
    if (event.target.closest('[data-replay]')) { play(0); return }
    const button = event.target.closest('button[role=tab]')
    if (!button) return
    const panel = button.dataset.panel
    if (panel) {
      for (const tab of example.querySelectorAll('.ex-tablist button')) {
        tab.setAttribute('aria-selected', String(tab === button))
      }
      for (const body of example.querySelectorAll('.ex-panel')) body.hidden = body.dataset.panel !== panel
      if (panel === 'result' && states.length > 1) play(0)
      return
    }
    const file = button.dataset.file
    if (!file) return
    const group = file.slice(0, file.indexOf(':') + 1)
    for (const tab of example.querySelectorAll('.ex-files button')) {
      if (tab.dataset.file.startsWith(group)) tab.setAttribute('aria-selected', String(tab === button))
    }
    for (const body of example.querySelectorAll('.ex-panel > [data-file]')) {
      if (body.dataset.file.startsWith(group)) body.hidden = body.dataset.file !== file
    }
  })
}
`

// A section overview OWNS its opening paragraphs; the main overview SHOWS the same words
// by pulling them, so the seam between the two cannot drift. The lead is everything before
// the section page's first `##`.
function leadOf(pages: Page[], slug: string): string {
    const source = pages.find((candidate) => candidate.slug === slug)
    if (!source) throw new Error(`buildDocs: {% lead ${slug} %} names a page NAV does not list`)
    const lead = source.body.split(/^## /m)[0]?.trim() ?? ''
    if (!lead) throw new Error(`buildDocs: ${slug} has no lead — its body opens on a heading`)
    // It renders on pages at other depths, so a relative link would resolve wrong.
    if (/]\((?!https?:|#)/.test(lead))
        throw new Error(
            `buildDocs: the lead of ${slug} has a relative link; leads render elsewhere`,
        )
    return lead
}

export async function renderPage(page: Page, pages: Page[], index: number): Promise<string> {
    const previous = pages[index - 1]
    const next = pages[index + 1]
    const root = '../'.repeat(page.slug.split('/').length - 1)
    const markdownName = `${basename(page.slug)}.md`
    let body = renderMarkdown(page.body)
    // Re-read per page rather than caching: the download links are relative to the
    // page they sit on, and there are two example embeds in the whole site.
    for (const match of [...body.matchAll(/<!--example:([\w-]+)-->/g)]) {
        const example = await readExample(match[1] ?? '', root)
        body = body.replace(match[0], example.html)
    }
    for (const match of [...body.matchAll(/<!--lead:([\w/-]+)-->/g)]) {
        body = body.replace(match[0], renderMarkdown(leadOf(pages, match[1] ?? '')))
    }
    body = linksToHtml(body)

    const hasExample = body.includes('<figure class="example"')
    const headings = renderHeadingList(body)
    let footer = ''
    if (previous)
        footer += `<a href="${linkTo(page.slug, previous.slug)}">&larr; ${renderInline(previous.nav)}</a>`
    if (next)
        footer += `<a class="next" href="${linkTo(page.slug, next.slug)}">${renderInline(next.nav)} &rarr;</a>`

    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title.replaceAll('`', '')} — abide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap">
<link rel="stylesheet" href="${root}docs.css">
<link rel="alternate" type="text/markdown" href="${markdownName}" title="${page.title.replaceAll('`', '')} as Markdown">
<body class="has-toc">
<a class="skip" href="#content">Skip to content</a>
<nav>
<a class="brand" href="${root}index.html">abide<span>docs</span></a>
${renderNav(pages, page.slug)}
</nav>
<main id="content">
${page.stub ? '<p class="notice">Stub — title and intent decided, prose not written.</p>' : ''}
<h1>${renderInline(page.title)}</h1>
${page.intent ? `<p class="intent">${renderInline(page.intent)}</p>` : ''}
${body}
<footer>${footer}</footer>
</main>
${renderRail(headings, markdownName, root)}
${headings ? `<script>${SCROLL_SPY}</script>` : ''}
${hasExample ? `<script>${EXAMPLE_TABS}</script>` : ''}
</body>
</html>
`
}

// MARKDOWN IS THE PAGE and HTML is derived from it, so `content/` links name the `.md`
// — which is what makes a content file correct when it is read where it lies, on GitHub
// or as a download, rather than only after a build. This is the derivation. An absolute
// URL keeps its own.
function linksToHtml(html: string): string {
    return html.replace(/href="(?!https?:|#)([^"]+)\.md/g, 'href="$1.html')
}

// The page EXPANDED — front matter as a heading, directives as fences — which is what the
// bundle needs and only the bundle: a reader who has the repo gets `content/<slug>.md`
// itself, hints intact, because that file is already the page.
export async function renderPageMarkdown(page: Page, pages: Page[]): Promise<string> {
    const root = '../'.repeat(page.slug.split('/').length - 1)
    let body = page.body.trim()
    // The directives expand into FENCES rather than panels — same source, same order,
    // no tab a reader of plain text cannot open.
    for (const match of [...body.matchAll(new RegExp(EXAMPLE.source, 'gm'))]) {
        body = body.replace(match[0], await exampleMarkdown(match[1] ?? '', root))
    }
    for (const match of [...body.matchAll(new RegExp(LEAD.source, 'gm'))]) {
        body = body.replace(match[0], leadOf(pages, match[1] ?? ''))
    }

    let head = `# ${page.title}\n`
    if (page.intent) head += `\n*${page.intent}*\n`
    if (page.stub) head += `\n> Stub — title and intent decided, prose not written.\n`
    return `${head}\n${body}\n`
}

// ONE FILE in reading order, for an agent that would otherwise fetch seventy. The text is
// the per-page `.md` verbatim; what this adds is the ORDER, the grouping the nav carries,
// and each page's own path — without which its relative links resolve against nothing.
export function renderBundle(pages: Page[], rendered: string[]): string {
    let contents = ''
    let section = ''
    let body = ''
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        if (page.section !== section) {
            section = page.section
            contents += `\n**${section}**\n\n`
        }
        contents += `- ${page.nav} — \`${page.slug}.md\`${page.stub ? ' (stub)' : ''}\n`
        body += `\n---\n\n<!-- ${page.slug}.md -->\n\n${rendered[index] ?? ''}`
    }
    return `# abide documentation

The whole of the abide documentation in reading order. Every page is also served on its own
at the \`.md\` beside its \`.html\`, and the links below point at those files — relative to
the path each page's marker comment names.

## Contents
${contents}${body}`
}

// The design brief lives in `src/ui/app.css` — a REAL stylesheet at the address the
// app's own `import '#ui/app.css'` will resolve to once `.abide` compiles, so the CSS
// does not have to move when the scaffold goes.
//
// The design brief in one place. The SIGNATURE is the code-block spine: every snippet
// names which side it runs on, because "same name, both sides" is the thing abide is
// claiming and a reader scanning for "where does this run" is the commonest question
// these docs answer. Amber is reserved for NOT-YET states — stubs, pending — and is
// never used decoratively, so its presence always means the same thing.
const STYLESHEET_SOURCE = new URL('../src/ui/app.css', import.meta.url)

export async function buildDocs(): Promise<Page[]> {
    const pages = await readPages()
    // Start from empty: a renamed page or a deleted example file otherwise lingers in
    // the output and goes on being served long after its source is gone.
    await rm(OUTPUT_DIR, { recursive: true, force: true })
    const markdown: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        await Bun.write(
            new URL(`${page.slug}.html`, OUTPUT_DIR),
            await renderPage(page, pages, index),
        )
        // A COPY, not a render: `content/<slug>.md` is already the page, so the download
        // and the repo file are the same bytes and there is nothing to keep in sync.
        await Bun.write(
            new URL(`${page.slug}.md`, OUTPUT_DIR),
            Bun.file(new URL(`${page.slug}.md`, CONTENT_DIR)),
        )
        // Indexed rather than pushed: the bundle reads it back by the page's own index.
        markdown[index] = await renderPageMarkdown(page, pages)
    }
    await Bun.write(new URL('abide.md', OUTPUT_DIR), renderBundle(pages, markdown))
    await Bun.write(new URL('docs.css', OUTPUT_DIR), Bun.file(STYLESHEET_SOURCE))

    // ONE ZIP PER EXAMPLE, so Download is a button rather than a menu. Entries carry
    // the example name as their first segment, so unzipping makes a folder.
    const examplesDir = new URL('../examples/', import.meta.url)
    const archives = new Map<string, ZipEntry[]>()
    for (const path of new Bun.Glob('*/{files,compiled,vanilla,tests}/**').scanSync({
        cwd: examplesDir.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        const entries = archives.get(name) ?? []
        entries.push({ path, source: await Bun.file(new URL(path, examplesDir)).text() })
        archives.set(name, entries)
    }
    for (const [name, entries] of archives) {
        entries.sort((a, b) => (a.path < b.path ? -1 : 1))
        await Bun.write(new URL(`examples/${name}.zip`, OUTPUT_DIR), zip(entries))
    }
    return pages
}

if (import.meta.main) {
    const pages = await buildDocs()
    const written = pages.filter((page) => !page.stub).length
    console.log(
        `docs: ${pages.length} pages -> packages/dogfood/dist (${written} written, ${pages.length - written} stubs), html and md, plus abide.md`,
    )

    if (Bun.argv.includes('--serve')) {
        const server = Bun.serve({
            port: Number(process.env.DOCS_PORT ?? 4000),
            async fetch(request) {
                const path = new URL(request.url).pathname
                const name = path === '/' ? 'index.html' : path.slice(1)
                const file = Bun.file(new URL(name, OUTPUT_DIR))
                return (await file.exists())
                    ? new Response(file)
                    : new Response('not found', { status: 404 })
            },
        })
        console.log(`docs: serving ${server.url}`)
    }
}
