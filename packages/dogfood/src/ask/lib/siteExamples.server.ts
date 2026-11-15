import { exampleDirectory } from '#src/lib/exampleDirectory.server.ts'

/** An example card on a docs page: where it is, and what it is made of. */
export type SiteExample = {
    id: string
    route: string
    title: string
    summary: string
    files: string[]
}

// The opening tag ends where the component the card shows begins: a title is free to hold a `>`.
const CARD = /<Example\b([\s\S]*?)>\s*<[A-Z]/g
const FILE_KEY = /'(src\/[^']+)':/g
const SERVER_FILES = /serverFiles=\{\[([\s\S]*?)\]\}/

/**
 * An attribute's text, written `name="…"` or as a string expression — `{'…'}`, `{"…"}` or
 * `{`…`}`, which a title holding a quote or a brace needs.
 */
function attributeOf(opening: string, name: string): string | undefined {
    const found = new RegExp(
        `\\b${name}=(?:"([^"]*)"|\\{'((?:[^'\\\\]|\\\\.)*)'\\}|\\{"((?:[^"\\\\]|\\\\.)*)"\\}|\\{\`([^\`]*)\`\\})`,
    ).exec(opening)
    if (found === null) return undefined
    const text = found[1] ?? found[2] ?? found[3] ?? found[4] ?? ''
    return found[1] === undefined ? text.replace(/\\(.)/g, '$1') : text
}

let read: Promise<SiteExample[]> | undefined

/**
 * Every `<Example>` the docs pages embed, read off the pages' own source once per process — the
 * page is the one home of a card, so the list the assistant offers cannot name a card no page has.
 */
export function siteExamples(): Promise<SiteExample[]> {
    read ??= readExamples()
    return read
}

async function readExamples(): Promise<SiteExample[]> {
    const crm = await exampleDirectory('crm')
    if (crm === undefined) return []
    const site = `${crm.slice(0, crm.lastIndexOf('/examples/'))}/src`
    const examples: SiteExample[] = []
    for await (const file of new Bun.Glob('**/index.abide').scan(site)) {
        const source = await Bun.file(`${site}/${file}`).text()
        const route = `/${file.slice(0, -'/index.abide'.length)}`
        for (const card of source.matchAll(CARD)) {
            const opening = card[1] ?? ''
            const id = attributeOf(opening, 'id')
            if (id === undefined) continue
            const files: string[] = []
            for (const key of opening.matchAll(FILE_KEY))
                files.push(key[1] ?? '')
            const server = SERVER_FILES.exec(opening)?.[1] ?? ''
            for (const shown of server.matchAll(/'([^']+)'/g))
                files.push(shown[1] ?? '')
            examples.push({
                id,
                route,
                title: attributeOf(opening, 'title') ?? '',
                summary: attributeOf(opening, 'summary') ?? '',
                files,
            })
        }
    }
    return examples
}
