import { exampleDirectory } from '#src/lib/exampleDirectory.server.ts'

/** An example card on a docs page: where it is, and what it is made of. */
export type SiteExample = {
    id: string
    route: string
    title: string
    summary: string
    files: string[]
}

const CARD = /<Example\b([\s\S]*?)>/g
const ATTRIBUTE = (name: string) => new RegExp(`\\b${name}="([^"]*)"`)
const FILE_KEY = /'(src\/[^']+)':/g

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
            const id = ATTRIBUTE('id').exec(opening)?.[1]
            if (id === undefined) continue
            const files: string[] = []
            for (const key of opening.matchAll(FILE_KEY)) files.push(key[1] ?? '')
            examples.push({
                id,
                route,
                title: ATTRIBUTE('title').exec(opening)?.[1] ?? '',
                summary: ATTRIBUTE('summary').exec(opening)?.[1] ?? '',
                files,
            })
        }
    }
    return examples
}
