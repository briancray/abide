// The benchmark's data, derived purely from an id so a server render and a client rebuild agree
// without seeding anything across the wire.

export interface Row {
    id: number
    label: string
}

export interface Record_ {
    id: number
    name: string
    owner: string
    status: 'active' | 'paused' | 'failed'
    amount: number
    tags: string[]
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

const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange']

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

const OWNERS = ['ada', 'grace', 'alan', 'edsger', 'barbara', 'donald', 'ken', 'dennis']

const STATUSES = ['active', 'paused', 'failed'] as const

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

// The dashboard's shape: a wider record with a status, a number to aggregate, and a small tag list
// so the medium page has a nested loop to reconcile.
export function buildRecords(from: number, count: number): Record_[] {
    const records: Record_[] = []
    for (let i = 0; i < count; i++) {
        const id = from + i
        records.push({
            id,
            name: labelFor(id),
            owner: OWNERS[id % OWNERS.length] as string,
            status: STATUSES[id % STATUSES.length] as 'active' | 'paused' | 'failed',
            amount: ((id * 37) % 900) + 100,
            tags: [COLOURS[id % COLOURS.length] as string, NOUNS[(id >> 3) % NOUNS.length] as string],
        })
    }
    return records
}
