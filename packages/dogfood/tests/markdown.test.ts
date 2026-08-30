import { expect, test } from 'bun:test'
import { readPages, renderBundle, renderPage, renderPageMarkdown } from '../scripts/buildDocs.ts'

async function markdownPages() {
    const pages = await readPages()
    const rendered: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        rendered[index] = await renderPageMarkdown(page, pages)
    }
    return { pages, rendered }
}

// A directive left in the output is the WHOLE example missing from the page an agent
// downloaded, and the prose around it still reads as though the code were there.
test('no page ships an unexpanded directive', async () => {
    const { pages, rendered } = await markdownPages()
    const leftovers: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        if (rendered[index]?.includes('{%')) leftovers.push(pages[index]?.slug ?? '')
    }
    expect(leftovers).toEqual([])
})

// `content/` is where the link is written, and it names the `.md` — so this gates the
// CONTENT, not a rewrite: a page that links to a slug NAV does not carry, or reverts to a
// `.html` spelling, is a dead link when the file is read where it lies.
test('every internal link names a markdown page that exists', async () => {
    const { pages, rendered } = await markdownPages()
    const slugs = new Set(pages.map((page) => page.slug))
    const broken: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        for (const match of (rendered[index] ?? '').matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
            const target = match[1] ?? ''
            if (target.endsWith('.zip')) continue
            // Resolved against the page's own directory, which is what a reader who
            // downloaded the tree has.
            const resolved = new URL(target, `file:///${page.slug}`).pathname.slice(1)
            if (!resolved.endsWith('.md') || !slugs.has(resolved.slice(0, -'.md'.length)))
                broken.push(`${page.slug}: ${target}`)
        }
    }
    expect(broken).toEqual([])
})

// The example's source files are the answer to the page's problem. A panel that renders
// in HTML and vanishes from the markdown is the silent half of this.
test('an embedded example brings its files into the markdown', async () => {
    const pages = await readPages()
    const page = pages.find(
        (candidate) => candidate.slug === 'server/read-data-without-writing-an-api',
    )
    const markdown = await renderPageMarkdown(page!, pages)
    expect(markdown).toContain('```ts #server/rpc/invoices.ts')
    expect(markdown).toContain('```abide #ui/pages/invoices/[id]/page.abide')
    expect(markdown).toContain('[read-invoice.zip](../examples/read-invoice.zip)')
})

test('the bundle carries every page, in nav order', async () => {
    const { pages, rendered } = await markdownPages()
    const bundle = renderBundle(pages, rendered)
    const markers = [...bundle.matchAll(/^<!-- (.+)\.md -->$/gm)].map((match) => match[1])
    expect(markers).toEqual(pages.map((page) => page.slug))
    for (const page of pages) expect(bundle).toContain(`- ${page.nav} — \`${page.slug}.md\``)
})

// The rail carries the downloads now, and it used to render only where there were two
// headings to list. A page with one heading has no table of contents and still has a
// download, so the offer is asserted on EVERY page rather than on a page that has both.
test('every page offers its own markdown and the bundle', async () => {
    const pages = await readPages()
    const missing: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await renderPage(page, pages, index)
        const name = page.slug.slice(page.slug.lastIndexOf('/') + 1)
        const root = '../'.repeat(page.slug.split('/').length - 1)
        if (!html.includes(`<a href="${name}.md" download>`)) missing.push(`${page.slug}: page`)
        if (!html.includes(`<a href="${root}abide.md" download>`))
            missing.push(`${page.slug}: bundle`)
        if (!html.includes(`<link rel="alternate" type="text/markdown" href="${name}.md"`))
            missing.push(`${page.slug}: alternate`)
    }
    expect(missing).toEqual([])
})

// HTML is DERIVED from the markdown now, so a body link that still names its `.md` is a
// 404 on the built site. The nav and the rail never had this problem — they are built from
// slugs — so the gate is on the body the markdown produced.
test('a rendered page links to html, and every link resolves', async () => {
    const pages = await readPages()
    const slugs = new Set(pages.map((page) => page.slug))
    const broken: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await renderPage(page, pages, index)
        const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
        for (const match of main.matchAll(/href="(?!https?:|#)([^"]+)"/g)) {
            const target = match[1] ?? ''
            if (target.endsWith('.zip')) continue
            const resolved = new URL(target, `file:///${page.slug}`).pathname.slice(1)
            if (!resolved.endsWith('.html') || !slugs.has(resolved.slice(0, -'.html'.length)))
                broken.push(`${page.slug}: ${target}`)
        }
    }
    expect(broken).toEqual([])
})
