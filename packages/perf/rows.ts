// The benchmark's data, derived purely from an id so a server render and a client rebuild agree
// without seeding anything across the wire.

export interface Row {
    id: number
    label: string
}

const ADJECTIVES = [
    'pretty',
    'large',
    'big',
    'small',
    'tall',
    'short',
    'long',
    'handsome',
    'plain',
    'quaint',
    'clean',
    'elegant',
    'easy',
    'angry',
    'crazy',
    'helpful',
    'mushy',
    'odd',
    'unsightly',
    'adorable',
    'important',
    'inexpensive',
    'cheap',
    'expensive',
    'fancy',
]

const COLOURS = [
    'red',
    'yellow',
    'blue',
    'green',
    'pink',
    'brown',
    'purple',
    'white',
    'black',
    'orange',
]

const NOUNS = [
    'table',
    'chair',
    'house',
    'bbq',
    'desk',
    'car',
    'pony',
    'cookie',
    'sandwich',
    'burger',
    'pizza',
    'mouse',
    'keyboard',
]

export function labelFor(id: number): string {
    const adjective = ADJECTIVES[id % ADJECTIVES.length] as string
    const colour = COLOURS[(id >> 2) % COLOURS.length] as string
    const noun = NOUNS[(id >> 4) % NOUNS.length] as string
    return `${adjective} ${colour} ${noun}`
}

export function buildRows(from: number, count: number): Row[] {
    const rows: Row[] = []
    for (let i = 0; i < count; i++) {
        const id = from + i
        rows.push({ id, label: labelFor(id) })
    }
    return rows
}
