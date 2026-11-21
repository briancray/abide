// THE DOCS AS THE GATES READ THEM: every page `SITE` lists, its `index.abide`, and the markdown the
// built app serves for it — what a reader with no browser reads, and so
// what the voice and coverage gates hold the words to.

import { addressOf, BIN } from '../../abide/tests/builtApp.ts'
import type { SitePage } from '../src/lib/SITE.ts'
import { groupOf, markdownAddressOf, PAGES } from '../src/lib/sitePages.ts'

/** The docs app's root, with a trailing slash. */
export const DOGFOOD = new URL('../', import.meta.url).pathname

export type DocsPage = SitePage & {
    /** The group it is listed under, `''` for the home page. */
    group: string
    /** The `index.abide`, from the docs app's root. */
    file: string
    /** Its text. */
    source: string
}

/** A page's `index.abide`, from the docs app's root. */
function pageFileOf(route: string): string {
    return `src${route === '/' ? '' : route}/index.abide`
}

let pages: Promise<DocsPage[]> | undefined

/** Every page `SITE` lists, in reading order. */
export function docsPages(): Promise<DocsPage[]> {
    pages ??= (async () => {
        const read: DocsPage[] = []
        for (const page of PAGES) {
            const file = pageFileOf(page.route)
            read.push({
                ...page,
                group: groupOf(page.route)?.group ?? '',
                file,
                source: await Bun.file(`${DOGFOOD}${file}`).text(),
            })
        }
        return read
    })()
    return pages
}

let served: Promise<{ base: string }> | undefined

const WHILE_OPEN = new URL('./whileOpen.ts', import.meta.url).pathname

/**
 * The built docs app, started once for the PROCESS that asks — `bun run test` builds it ahead of the
 * tests — and stopped as that process ends, however it ends (`whileOpen.ts`).
 *
 * PER PROCESS, NOT PER FILE: a module is evaluated once however many files import it, so a stop
 * hooked to the first file's `afterAll` left every later file in a serial run reading a server that
 * was gone.
 */
export function servedDocs(): Promise<{ base: string }> {
    if (served === undefined) {
        // `DOCS_OUT` names a build of one's own, for a run beside another that is building.
        const server = Bun.spawn(
            [
                'bun',
                WHILE_OPEN,
                'bun',
                BIN,
                'start',
                '--root',
                `${DOGFOOD}src`,
                '--out',
                process.env.DOCS_OUT ?? `${DOGFOOD}.abide`,
                '--port',
                '0',
            ],
            { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env },
        )
        served = addressOf(server).then((base) => ({ base }))
    }
    return served
}

let markdown: Promise<Map<string, string>> | undefined

/**
 * Each page's body as the built app answers `addressOfRoute(route)`, keyed by route — eight in
 * flight. One page after another was most of a gate's wall clock; every page at once is more
 * sockets than the served app will hold.
 */
async function rendered(
    addressOfRoute: (route: string) => string,
): Promise<Map<string, string>> {
    const { base } = await servedDocs()
    const pages = await docsPages()
    const texts: string[] = []
    let next = 0
    const workers: Promise<void>[] = []
    for (let lane = 0; lane < 8; lane += 1)
        workers.push(
            (async () => {
                while (next < pages.length) {
                    const at = next++
                    const address = addressOfRoute(
                        (pages[at] as DocsPage).route,
                    )
                    const answer = await Bun.fetch(`${base}${address}`)
                    if (!answer.ok)
                        throw new Error(
                            `docs: ${address} answered ${answer.status}`,
                        )
                    texts[at] = await answer.text()
                }
            })(),
        )
    await Promise.all(workers)
    const bodies = new Map<string, string>()
    for (let at = 0; at < pages.length; at += 1)
        bodies.set((pages[at] as DocsPage).route, texts[at] as string)
    return bodies
}

/**
 * What a page WRITES, off its markdown: everything before its Tests and its Rules, which are QUOTED
 * — a test case at its file's width, a clause in the rulebook's keywords — and answer to the file
 * and the rulebook rather than to the voice and the column a page's own words are held to.
 */
export function written(body: string): string {
    let end = body.length
    for (const part of ['\n## Tests\n', '\n## Rules\n']) {
        const at = body.indexOf(part)
        if (at !== -1 && at < end) end = at
    }
    return body.slice(0, end)
}

/** Each page's markdown, as the built app serves it at the page's address with `.md` on the end. */
export function renderedMarkdown(): Promise<Map<string, string>> {
    markdown ??= rendered(markdownAddressOf)
    return markdown
}

/** A `<Code>` block a page writes by hand, `code` as the template literal spells it, unescaped. */
export type Fence = { language: string; caption: string; code: string }

/**
 * Where the self-closing tag opening at `from` ends, past its `/>` — stepping over quotes and braces,
 * so a `/>` inside a `code={`…`}` does not end it.
 */
function tagEnd(source: string, from: number): number {
    let depth = 0
    let quote = ''
    for (let at = from; at < source.length; at += 1) {
        const character = source[at] as string
        if (quote !== '') {
            if (character === '\\') at += 1
            else if (character === quote) quote = ''
            continue
        }
        if (character === '"' || character === "'" || character === '`')
            quote = character
        else if (character === '{') depth += 1
        else if (character === '}') depth -= 1
        else if (depth === 0 && source.startsWith('/>', at)) return at + 2
    }
    return source.length
}

/** The text of the `code={`…`}` in `tag`, its escapes undone — `''` where it has none. */
function codeIn(tag: string): string {
    const open = tag.indexOf('code={`')
    if (open === -1) return ''
    let code = ''
    for (let at = open + 'code={`'.length; at < tag.length; at += 1) {
        const character = tag[at] as string
        if (character === '`') break
        if (character === '\\') {
            at += 1
            code += tag[at] ?? ''
        } else code += character
    }
    return code
}

// A page writes `language` and `caption` as plain quoted text.
const attributeIn = (tag: string, name: string): string =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

/** Every `<Code>` a page writes, in order. */
export function fencesOf(page: DocsPage): Fence[] {
    const fences: Fence[] = []
    const source = page.source
    const tags = /<Code\b/g
    for (let match = tags.exec(source); match; match = tags.exec(source)) {
        const end = tagEnd(source, match.index)
        const tag = source.slice(match.index, end)
        fences.push({
            language: attributeIn(tag, 'language'),
            caption: attributeIn(tag, 'caption'),
            code: codeIn(tag),
        })
        tags.lastIndex = end
    }
    return fences
}

let html: Promise<Map<string, string>> | undefined

/** Each page's document, as the built app serves it. */
export function renderedHtml(): Promise<Map<string, string>> {
    html ??= rendered((route) => route)
    return html
}
