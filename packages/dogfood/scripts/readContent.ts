// THE CONTENT, READ. `content/**.md` plus the order in `NAV.ts` is the documentation, and this
// turns one page of it into the three forms the app needs: the rendered body, the heading list
// its rail shows, and the markdown twin a reader downloads.
//
// IT WRITES NOTHING. `scripts/buildPages.ts` is what compiles this into the abide app under
// `src/`, and the tests read it directly — which is the whole reason the reading and the writing
// are two files: a gate on the prose should not have to build a site to ask its question.

import { NAV } from './NAV.ts'
import { exampleMarkdown, readExample } from './renderExample.ts'
import {
    EXAMPLE,
    groupSections,
    LEAD,
    renderInline,
    renderMarkdown,
    SNIPPET,
} from './renderMarkdown.ts'
import { snippetHtml, snippetMarkdown } from './renderSnippet.ts'

const CONTENT_DIR = new URL('../content/', import.meta.url)

export type Page = {
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
    // The REGISTRY sections a reference page enumerates. `covers:` is the guides' claim and a
    // reference page is refused one, so this is the parallel claim for the other document type:
    // a guide claims a capability, a reference page claims a whole section of the surface.
    enumerates: string[]
    stub: boolean
    body: string
}

// Front matter is `key: value` lines between two `---` rules, plus a `- item` list
// form. The list form is not decoration: a capability name may contain a comma, a

function readFrontMatter(source: string): {
    fields: Map<string, string[]>
    body: string
} {
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
                throw new Error(
                    `docs: NAV names ${slug}, content/${slug}.md is missing`,
                )
            const { fields, body } = readFrontMatter(await file.text())
            pages.push({
                slug,
                section: group.section,
                title: fields.get('title')?.[0] ?? slug,
                nav: fields.get('nav')?.[0] ?? fields.get('title')?.[0] ?? slug,
                intent: fields.get('intent')?.[0] ?? '',
                covers: fields.get('covers') ?? [],
                examples: fields.get('examples') ?? [],
                enumerates: fields.get('enumerates') ?? [],
                stub: fields.get('status')?.[0] === 'stub',
                body,
            })
        }
    }
    return pages
}

// Every href is RELATIVE to the page it sits on, so `dist/index.html` opens over

function leadOf(pages: Page[], slug: string): string {
    const source = pages.find((candidate) => candidate.slug === slug)
    if (!source)
        throw new Error(
            `docs: {% lead ${slug} %} names a page NAV does not list`,
        )
    const lead = source.body.split(/^## /m)[0]?.trim() ?? ''
    if (!lead)
        throw new Error(
            `docs: ${slug} has no lead — its body opens on a heading`,
        )
    // It renders on pages at other depths, so a relative link would resolve wrong.
    if (/]\((?!https?:|#)/.test(lead))
        throw new Error(
            `docs: the lead of ${slug} has a relative link; leads render elsewhere`,
        )
    return lead
}

// A PAGE'S ADDRESS. `index` is the app's root and a section's `index` is the section's own
// address, which is what makes `content/values/index.md` the page at `/values` rather than a
// directory listing nobody wrote.
export function routeOf(slug: string): string {
    if (slug === 'index') return '/'
    if (slug.endsWith('/index')) return `/${slug.slice(0, -'/index'.length)}`
    return `/${slug}`
}

// The markdown twin's address: the content path, served as a file. 40.4 — the same words at the
// same place with `.md` on the end, which is also why it cannot collide with a route (36.13).
export function markdownAddressOf(slug: string): string {
    return `/${slug}.md`
}

// THE BODY, RENDERED. The directives expand in the order they have to: a LEAD is a section
// page's opening and an opening carries the example that page leads with, so the passes that
// expand one run after it — or the overview ships the marker instead of the figure.
//
// EVERY REPLACEMENT TAKES THE FUNCTION FORM. A string replacement is not literal —
// `String.replace` reads `$&`, `` $` ``, `$'` and `$1` out of it — so an example holding `'$'`
// for a currency sign inserted the entire rest of the document.
export async function renderBody(page: Page, pages: Page[]): Promise<string> {
    let body = renderMarkdown(page.body)
    for (const match of [...body.matchAll(/<!--lead:([\w/-]+)-->/g)]) {
        const lead = renderMarkdown(leadOf(pages, match[1] ?? ''))
        body = body.replace(match[0], () => lead)
    }
    for (const match of [...body.matchAll(/<!--example:([\w-]+)-->/g)]) {
        const example = await readExample(match[1] ?? '', '/')
        body = body.replace(match[0], () => example.html)
    }
    for (const match of [...body.matchAll(/<!--snippet:(\{.*?\})-->/g)]) {
        const html = await snippetHtml(JSON.parse(match[1] ?? '{}'))
        body = body.replace(match[0], () => html)
    }
    return groupSections(linksToRoutes(body, page.slug))
}

// MARKDOWN IS THE PAGE and the app is derived from it, so a `content/` link names the `.md` —
// which is what makes a content file correct when it is read where it lies, on GitHub or as a
// download, rather than only after a build. This is the derivation, and what it derives now is
// an ADDRESS rather than a file beside the page: the app answers `/values/show-a-value` and
// there is no tree of files for a relative link to walk.
function linksToRoutes(html: string, from: string): string {
    // The page's own directory, as a base to resolve against. A page at the root has none, and
    // `file:///${''}/` is a doubled separator that resolves every link on the overview to an
    // address with two slashes in front of it.
    const at = from.lastIndexOf('/')
    const within = at === -1 ? 'file:///' : `file:///${from.slice(0, at)}/`
    return html.replace(
        /href="(?!https?:|#|\/)([^"#]+)\.md(#[^"]*)?"/g,
        (_whole, path: string, hash: string | undefined) =>
            `href="${routeOf(new URL(path, within).pathname.slice(1))}${hash ?? ''}"`,
    )
}

// A heading in the body, as the rail lists it. `label` is the heading's own inline HTML, so a
// `code` span in a heading is a `code` span in the rail.
export type DocsHeading = { level: string; id: string; label: string }

// The heading list, read off the RENDERED body rather than the markdown, so a heading's link
// text is the same inline HTML the heading itself got — a `code` span included.
//
// ONE HEADING IS NOT A TABLE OF CONTENTS, it is a repeat of the title, so the rail shows none.
export function headingsOf(body: string): DocsHeading[] {
    const pattern = /<h([23]) id="([^"]+)">(.*?)<\/h\1>/g
    const headings: DocsHeading[] = []
    for (let match = pattern.exec(body); match; match = pattern.exec(body))
        headings.push({
            level: match[1] as string,
            id: match[2] as string,
            label: match[3] as string,
        })
    return headings.length < 2 ? [] : headings
}

export async function renderPageMarkdown(
    page: Page,
    pages: Page[],
): Promise<string> {
    const root = '../'.repeat(page.slug.split('/').length - 1)
    let body = page.body.trim()
    // The directives expand into FENCES rather than panels — same source, same order,
    // no tab a reader of plain text cannot open. LEAD runs first for the reason the HTML
    // path gives: an opening it pulls in may itself embed an example or a snippet.
    //
    // EVERY REPLACEMENT TAKES THE FUNCTION FORM. A string replacement is not literal —
    // `String.replace` reads `$&`, `` $` ``, `$'` and `$1` out of it — so an example
    // holding `'$'` for a currency sign inserted the entire rest of the document and left
    // every directive after it unexpanded, with the build still exiting 0.
    for (const match of [...body.matchAll(new RegExp(LEAD.source, 'gm'))]) {
        const lead = leadOf(pages, match[1] ?? '')
        body = body.replace(match[0], () => lead)
    }
    for (const match of [...body.matchAll(new RegExp(EXAMPLE.source, 'gm'))]) {
        const markdown = await exampleMarkdown(match[1] ?? '', root)
        body = body.replace(match[0], () => markdown)
    }
    for (const match of [...body.matchAll(new RegExp(SNIPPET.source, 'gm'))]) {
        const markdown = await snippetMarkdown({
            example: match[1] ?? '',
            file: match[2] ?? '',
            anchor: match[3] ?? '',
        })
        body = body.replace(match[0], () => markdown)
    }

    let head = `# ${page.title}\n`
    if (page.intent) head += `\n*${page.intent}*\n`
    if (page.stub)
        head += `\n> Stub — title and intent decided, prose not written.\n`
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
