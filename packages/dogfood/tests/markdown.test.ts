import { expect, test } from 'bun:test'
import { directoryOf, pageSource, railOf } from '../scripts/buildPages.ts'
import {
    type Page,
    readPages,
    renderBody,
    renderBundle,
    renderPageMarkdown,
    routeOf,
} from '../scripts/readContent.ts'

// THE PAGE AS THE APP HOLDS IT. What used to be one HTML document is now a body, a rail and a
// `.abide` that carries both — so a gate on the prose asks the body, and a gate on what the page
// OFFERS asks the two the generator writes around it.
async function bodyOf(page: Page, pages: Page[]): Promise<string> {
    return await renderBody(page, pages)
}

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
        if (rendered[index]?.includes('{%'))
            leftovers.push(pages[index]?.slug ?? '')
    }
    expect(leftovers).toEqual([])
})

// The unexpanded-directive test above caught a build bug ONLY BY LUCK. `String.replace`
// with a STRING replacement reads `$&`, `` $` ``, `$'` and `$1` out of it, so an example
// carrying `'$'` for a currency sign inserted the whole rest of the document at that point —
// duplicating every section after it. What made it visible was that the duplicate happened
// to contain directives; had the corrupted example been the LAST one, the build would have
// shipped a page with three sections twice and exited 0. So the duplication is asserted
// directly, on the one thing a doubled region cannot hide: a heading appearing twice.
test('no page ships a section twice', async () => {
    const { pages, rendered } = await markdownPages()
    const doubled: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const seen = new Set<string>()
        for (const line of (rendered[index] ?? '').split('\n')) {
            if (!line.startsWith('## ')) continue
            if (seen.has(line)) doubled.push(`${pages[index]?.slug}: ${line}`)
            seen.add(line)
        }
    }
    expect(doubled).toEqual([])
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
        for (const match of (rendered[index] ?? '').matchAll(
            /\]\((?!https?:|#)([^)]+)\)/g,
        )) {
            const target = match[1] ?? ''
            if (target.endsWith('.zip')) continue
            // Resolved against the page's own directory, which is what a reader who
            // downloaded the tree has.
            const resolved = new URL(
                target,
                `file:///${page.slug}`,
            ).pathname.slice(1)
            if (
                !resolved.endsWith('.md') ||
                !slugs.has(resolved.slice(0, -'.md'.length))
            )
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
        (candidate) =>
            candidate.slug === 'server/read-data-without-writing-an-api',
    )
    const markdown = await renderPageMarkdown(page!, pages)
    expect(markdown).toContain('```ts #server/rpc/invoices.ts')
    expect(markdown).toContain('```abide #ui/pages/invoices/[id]/page.abide')
    expect(markdown).toContain('[rpc-call.zip](../examples/rpc-call.zip)')
})

test('the bundle carries every page, in nav order', async () => {
    const { pages, rendered } = await markdownPages()
    const bundle = renderBundle(pages, rendered)
    const markers = [...bundle.matchAll(/^<!-- (.+)\.md -->$/gm)].map(
        (match) => match[1],
    )
    expect(markers).toEqual(pages.map((page) => page.slug))
    for (const page of pages)
        expect(bundle).toContain(`- ${page.nav} — \`${page.slug}.md\``)
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
        const rail = railOf(page, await bodyOf(page, pages))
        const source = pageSource(page, directoryOf(page.slug))
        if (!rail.includes(`<a href="/${page.slug}.md" download>`))
            missing.push(`${page.slug}: page`)
        if (!rail.includes('<a href="/abide.md" download>'))
            missing.push(`${page.slug}: bundle`)
        if (
            !source.includes(
                `<link rel="alternate" type="text/markdown" href="/${page.slug}.md"`,
            )
        )
            missing.push(`${page.slug}: alternate`)
    }
    expect(missing).toEqual([])
})

// THE BODY IS DERIVED from the markdown, so a link that still names its `.md` is a 404 on the
// served app. The nav and the rail never had this problem — they are built from slugs — so the
// gate is on the body the markdown produced, and what it must hold is an ADDRESS the app
// answers rather than a file beside the page.
test('a rendered body links to an address the app answers', async () => {
    const pages = await readPages()
    const addresses = new Set(pages.map((page) => routeOf(page.slug)))
    const broken: string[] = []
    for (const page of pages) {
        const body = await bodyOf(page, pages)
        for (const match of body.matchAll(/href="(?!https?:|#)([^"]+)"/g)) {
            const target = match[1] ?? ''
            // The example downloads and the markdown twins are files under `public`, which is
            // the other half of what the app answers (36.11).
            if (target.endsWith('.zip') || target.endsWith('.md')) continue
            const [address] = target.split('#') as [string]
            if (!addresses.has(address)) broken.push(`${page.slug}: ${target}`)
        }
    }
    expect(broken).toEqual([])
})

// A table cell opening on `yes` / `no` renders as a coloured verdict and a recessive
// reason. The guard is the half worth testing: `no route matched, or no handler is
// mounted` is a SENTENCE beginning with the word, and styling its first two letters red
// is wrong in a way nothing would report — the page still renders and the table still
// reads. Both directions are asserted, because loosening the pattern breaks only one.
test('a verdict cell is marked up, and a sentence that opens on one is not', async () => {
    const pages = await readPages()
    const holds = pages.find(
        (page) => page.slug === 'values/show-a-value-that-isnt-there-yet',
    )
    const rendered = await bodyOf(holds as Page, pages)
    expect(rendered).toContain('<b class="verdict-no">no</b>')
    expect(rendered).toContain('<b class="verdict-yes">yes</b>')
    expect(rendered).toContain(
        '<span class="verdict-why"> — the read renders nothing',
    )

    const failures = pages.find(
        (page) => page.slug === 'server/refuse-a-request-and-say-why',
    )
    const prose = await bodyOf(failures as Page, pages)
    expect(prose).toContain('<td>no route matched')
})

// A `**` or a `](` reaching the HTML is inline markup the renderer could not represent, and it
// fails SILENTLY in the one direction nothing else here watches: the markdown download stays
// correct, so every gate that reads the markdown passes while the page a reader opens shows its
// asterisks and its brackets. `renderInline` used to apply emphasis and links per backtick
// SEGMENT, so anything straddling a code span — `**`x`**`, or a link whose TEXT is code — had its
// opener and its closer in different strings and neither matched. On one page the orphaned `**`
// then paired with another two sentences later and emboldened the prose between them.
//
// Both markers occur legitimately in code, and in two places a reader never sees as prose: a glob
// (`#server/rpc/**`) inside a span, and `TRANSFORMS[rule.transform](value)` in the driver script
// an example panel carries. So the check STRIPS rather than exempts a page — an exemption list
// would have had to name the panel every example embeds.
//
// With the code-span lift in `renderInline` reverted: 14 pages — 7 on each marker, none on both.
test('no page ships inline markup the renderer could not read', async () => {
    const pages = await readPages()
    const literal: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await bodyOf(page, pages)
        const prose = html
            .replace(/<script[\s\S]*?<\/script>/g, '')
            .replace(/srcdoc="[\s\S]*?"/g, '')
            .replace(/<pre>[\s\S]*?<\/pre>/g, '')
            .replace(/<code>[\s\S]*?<\/code>/g, '')
        if (prose.includes('**')) literal.push(`${page.slug}: emphasis`)
        if (prose.includes('](')) literal.push(`${page.slug}: link`)
    }
    expect(literal).toEqual([])
})

// A `\\|` is the only way to write a union type in a table cell, and splitting a row on every pipe
// broke that cell in two and left the backslash in the output — `() => void \\` beside a cell
// reading `Disposer`, and every cell after it shunted one column right. Silent the usual way: the
// table renders, the page looks fine, and only a reader who knows the type notices it is wrong.
//
// Checked on the RENDERED row rather than on the markdown, because what went wrong was the split:
// a row whose header declares three columns has to produce three cells.
//
// With the escaped-pipe split in `renderTableRow` reverted: 7 pages.
test('a table row has as many cells as its header declares', async () => {
    const pages = await readPages()
    const ragged: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await bodyOf(page, pages)
        for (const table of html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
            const body = table[1] ?? ''
            const columns = (body.match(/<th>/g) ?? []).length
            if (!columns) continue
            for (const row of body.matchAll(
                /<tr>((?:<td>[\s\S]*?<\/td>)+)<\/tr>/g,
            )) {
                const cells = (row[1]?.match(/<td>/g) ?? []).length
                if (cells !== columns)
                    ragged.push(
                        `${page.slug}: ${cells} cells under ${columns} columns`,
                    )
            }
        }
    }
    expect(ragged).toEqual([])
})

// The backslash itself, which is what a reader actually sees. Escaped anywhere else in prose it
// would be legitimate, so this looks only where the escape has a meaning the renderer must undo.
test('no rendered table cell ships the backslash of an escaped pipe', async () => {
    const pages = await readPages()
    const stray: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await bodyOf(page, pages)
        for (const table of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
            if (/\\(?=\s*<\/(?:td|code)>)/.test(table[0])) stray.push(page.slug)
        }
    }
    expect([...new Set(stray)]).toEqual([])
})

// A CAPTION HAS TO NAME THE SYNTAX. `browser` says where the code runs and leaves a reader to
// guess whether they are looking at a name read by name in a `.abide` file or at `s()` in a `.ts`
// one — which are the two forms this whole design is about, so guessing is not acceptable. Seventy
// -one fences shipped captioned by seam alone.
//
// Asserted on the RENDERED caption rather than on the fence, because the syntax is derived from
// the language token rather than written into the label: what regresses is the derivation, not the
// markdown, and the markdown would look unchanged either way.
//
// With `captionOf` reverted to `displayPath`: 52 pages.
test('every code caption names a syntax or a file', async () => {
    const pages = await readPages()
    const vague: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await bodyOf(page, pages)
        for (const caption of html.matchAll(
            /<figcaption>([^<]*)<\/figcaption>/g,
        )) {
            const text = caption[1] ?? ''
            if (
                text.startsWith('.') ||
                text.startsWith('#') ||
                text.startsWith('src/')
            )
                continue
            vague.push(`${page.slug}: "${text}"`)
        }
    }
    expect([...new Set(vague)]).toEqual([])
})
