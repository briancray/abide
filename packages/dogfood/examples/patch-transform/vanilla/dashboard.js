function applyOrderCount(byId, frame) {
    const held = byId.get(frame.id)
    if (held) held.orders = frame.orders
}

const held = { value: new Map(), readers: new Set(), pending: true }

function wake() {
    for (const reader of held.readers) reader(held)
}

function patch(mutate) {
    mutate(held.value)
    wake()
}

// THE RESHAPE, WRITTEN BY HAND AT THE LOAD. The answer is an array and
// every frame after it names an id, so the fold either indexes once here
// or scans the array per frame. Doing it here is the whole of `transform`
// — and it has to happen in this one place, which is the part that goes
// wrong once a second caller loads this and folds the array its own way.
async function load() {
    const rows = await fetch('/api/regions').then((answer) => answer.json())
    held.value = new Map(rows.map((row) => [row.id, row]))
    held.pending = false
    wake()
}

const FEED = [
    { id: 'south', orders: 95 },
    { id: 'north', orders: 130 },
    { id: 'west', orders: 88 },
    { id: 'east', orders: 71 },
]

const list = document.querySelector('#regions')
const status = document.querySelector('#status')

held.readers.add((state) => {
    status.textContent = state.pending ? 'loading…' : ''
    list.replaceChildren(
        ...[...state.value.values()].map((region) => {
            const row = document.createElement('li')
            const label = document.createElement('span')
            label.textContent = region.name
            const value = document.createElement('strong')
            value.textContent = String(region.orders)
            row.append(label, value)
            return row
        }),
    )
})

// A frame names an id, so the write is a `get` rather than a scan.
document.querySelector('#apply').addEventListener('click', () => {
    const frame = FEED.shift()
    if (!frame) return
    FEED.push(frame)
    patch((byId) => applyOrderCount(byId, frame))
})

// The first paint is the reader's, so the pending line on screen is the arm's
// doing rather than something the markup shipped already saying.
wake()
load()
