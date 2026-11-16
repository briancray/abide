// The opening tag ends where the component the card shows begins: a title is free to hold a `>`.
const CARD = /<Example\b([\s\S]*?)>\s*<([A-Z]\w*)/g
const SERVER_FILES = /serverFiles=\{\[([\s\S]*?)\]\}/

/**
 * Each `<Example>` card a page's `source` embeds, in order: its opening tag's attributes (read them
 * with `attributeOf`), the component it renders, and the CRM server files it reads by path.
 *
 * What the assistant's card list and the docs tests both walk a page by.
 */
export function exampleCardsIn(
    source: string,
): { opening: string; component: string; serverFiles: string[] }[] {
    const cards: {
        opening: string
        component: string
        serverFiles: string[]
    }[] = []
    for (const [, opening = '', component = ''] of source.matchAll(CARD)) {
        const serverFiles: string[] = []
        const listed = SERVER_FILES.exec(opening)?.[1] ?? ''
        for (const [, shown = ''] of listed.matchAll(/'([^']+)'/g))
            serverFiles.push(shown)
        cards.push({ opening, component, serverFiles })
    }
    return cards
}
