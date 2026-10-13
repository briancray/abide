// THE DOCS AS THE GATES READ THEM: every page `SITE` lists, its `index.abide`, the example cards it
// embeds, and the markdown the built app serves for it — what a reader with no browser reads, and so
// what the voice and coverage gates hold the words to.

import { addressOf, BIN } from '../../abide/tests/builtApp.ts'
import { SITE, type SitePage } from '../src/lib/SITE.ts'
import { markdownAddressOf } from '../src/lib/sitePages.ts'

/** The docs app's root, with a trailing slash. */
export const DOGFOOD = new URL('../', import.meta.url).pathname

export type DocsPage = SitePage & {
    section: string
    /** The `index.abide`, from the docs app's root. */
    file: string
    /** Its text. */
    source: string
}

/** One `<Example>` card on a page. */
export type Card = {
    id: string
    /** The page embedding it. */
    route: string
    /** The component it renders, from the docs app's root. */
    component: string
    /** Each file the card shows, by the path a reader is shown, to the file from the docs app's root. */
    files: Map<string, string>
}

/** A page's `index.abide`, from the docs app's root. */
export function pageFileOf(route: string): string {
    return `src${route === '/' ? '' : route}/index.abide`
}

let pages: Promise<DocsPage[]> | undefined

/** Every page `SITE` lists, in reading order. */
export function docsPages(): Promise<DocsPage[]> {
    pages ??= (async () => {
        const read: DocsPage[] = []
        for (const group of SITE)
            for (const page of group.pages) {
                const file = pageFileOf(page.route)
                read.push({
                    ...page,
                    section: group.section,
                    file,
                    source: await Bun.file(`${DOGFOOD}${file}`).text(),
                })
            }
        return read
    })()
    return pages
}

// Where a page's import lands, from the docs app's root.
function resolvedFrom(file: string, specifier: string): string {
    if (specifier.startsWith('#src/'))
        return `src/${specifier.slice('#src/'.length)}`
    return new URL(specifier, `file://${DOGFOOD}${file}`).pathname.slice(
        DOGFOOD.length,
    )
}

const IMPORT = /^import (\w+) from '([^']+)'(?: with \{ type: 'text' \})?$/gm
const CARD = /<Example\b([\s\S]*?)>\s*<([A-Z]\w*)/g
const FILE_ENTRY = /'([^']+)':\s*(\w+)/g

/** The cards `page` embeds, in the order it embeds them. */
export function cardsOf(page: DocsPage): Card[] {
    const imported = new Map<string, string>()
    for (const [, name, specifier] of page.source.matchAll(IMPORT))
        imported.set(
            name as string,
            resolvedFrom(page.file, specifier as string),
        )
    const cards: Card[] = []
    for (const [, attributes, tag] of page.source.matchAll(CARD)) {
        const id = /\bid="([^"]+)"/.exec(attributes as string)?.[1] ?? ''
        const files = new Map<string, string>()
        const listed =
            /files=\{\{([\s\S]*?)\}\}/.exec(attributes as string)?.[1] ?? ''
        for (const [, shown, source] of listed.matchAll(FILE_ENTRY))
            files.set(shown as string, imported.get(source as string) ?? '')
        cards.push({
            id,
            route: page.route,
            component: imported.get(tag as string) ?? '',
            files,
        })
    }
    return cards
}

/** Every card in the docs, in reading order. */
export async function allCards(): Promise<Card[]> {
    const cards: Card[] = []
    for (const page of await docsPages()) cards.push(...cardsOf(page))
    return cards
}

let served: Promise<{ base: string; stop: () => void }> | undefined

const WHILE_OPEN = new URL('./whileOpen.ts', import.meta.url).pathname

/**
 * The built docs app, started once for the PROCESS that asks — `bun run test` builds it ahead of the
 * tests — and stopped as that process ends, however it ends (`whileOpen.ts`).
 *
 * PER PROCESS, NOT PER FILE: a module is evaluated once however many files import it, so a stop
 * hooked to the first file's `afterAll` left every later file in a serial run reading a server that
 * was gone.
 */
export function servedDocs(): Promise<{ base: string; stop: () => void }> {
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
        served = addressOf(server).then((base) => ({
            base,
            stop: () => void server.stdin.end(),
        }))
    }
    return served
}

let markdown: Promise<Map<string, string>> | undefined

/** Each page's markdown, as the built app serves it at the page's address with `.md` on the end. */
export function renderedMarkdown(): Promise<Map<string, string>> {
    markdown ??= (async () => {
        const { base } = await servedDocs()
        const bodies = new Map<string, string>()
        for (const page of await docsPages()) {
            const address = markdownAddressOf(page.route)
            const answer = await Bun.fetch(`${base}${address}`)
            if (!answer.ok)
                throw new Error(`docs: ${address} answered ${answer.status}`)
            bodies.set(page.route, await answer.text())
        }
        return bodies
    })()
    return markdown
}

/** A `<Code>` block a page writes by hand, with the `<Section>` it sits in. */
export type Fence = {
    language: string
    caption: string
    code: string
    /** The title of the section it sits in, or `''` before the first. */
    section: string
}

/**
 * Where the tag opening at `from` ends — past its `>`, or its `/>` where `closed` — stepping over
 * quotes and braces, so a `>` inside an attribute's value does not end it.
 */
export function tagEnd(source: string, from: number, closed = true): number {
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
        else if (depth === 0 && closed && source.startsWith('/>', at))
            return at + 2
        else if (depth === 0 && !closed && character === '>') return at + 1
    }
    return source.length
}

/** An attribute's value as written: `"…"`, `{'…'}` or `` {`…`} ``. */
export function attributeOf(tag: string, name: string): string {
    const plain = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
    if (plain) return plain[1] as string
    const quoted = new RegExp(`\\b${name}=\\{'((?:\\\\.|[^'])*)'\\}`).exec(tag)
    if (quoted) return (quoted[1] as string).replace(/\\(.)/g, '$1')
    const template = new RegExp(`\\b${name}=\\{\`((?:\\\\.|[^\`])*)\`\\}`).exec(
        tag,
    )
    if (template) return (template[1] as string).replace(/\\(.)/g, '$1')
    return ''
}

/** Every `<Code>` a page writes, in order. */
export function fencesOf(page: DocsPage): Fence[] {
    const fences: Fence[] = []
    const source = page.source
    const tags = /<(Section|Code)\b/g
    let section = ''
    for (let match = tags.exec(source); match; match = tags.exec(source)) {
        if (match[1] === 'Section') {
            section = attributeOf(
                source.slice(match.index, tagEnd(source, match.index, false)),
                'title',
            )
            continue
        }
        const end = tagEnd(source, match.index)
        const tag = source.slice(match.index, end)
        fences.push({
            language: attributeOf(tag, 'language'),
            caption: attributeOf(tag, 'caption'),
            code: attributeOf(tag, 'code'),
            section,
        })
        tags.lastIndex = end
    }
    return fences
}

let html: Promise<Map<string, string>> | undefined

/** Each page's document, as the built app serves it. */
export function renderedHtml(): Promise<Map<string, string>> {
    html ??= (async () => {
        const { base } = await servedDocs()
        const documents = new Map<string, string>()
        for (const page of await docsPages()) {
            const answer = await Bun.fetch(`${base}${page.route}`)
            if (!answer.ok)
                throw new Error(`docs: ${page.route} answered ${answer.status}`)
            documents.set(page.route, await answer.text())
        }
        return documents
    })()
    return html
}
