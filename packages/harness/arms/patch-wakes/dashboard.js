function applyOrderCount(byId, frame) {
    const held = byId.get(frame.id)
    if (held) held.orders = frame.orders
}

// THE HELD VALUE AND ITS READERS, WRITTEN BY HAND. `patch` is the two
// lines of `patch()` below: change what is already held, then mint the
// production that wakes the readers watching it. Neither half is worth
// anything alone — the mutation moves nothing, the production says nothing.
const held = {
    value: new Map([
        ['north', { id: 'north', name: 'North', orders: 120 }],
        ['south', { id: 'south', name: 'South', orders: 80 }],
        ['east', { id: 'east', name: 'East', orders: 64 }],
        ['west', { id: 'west', name: 'West', orders: 91 }],
    ]),
    readers: new Set(),
}

function patch(mutate) {
    mutate(held.value)
    for (const reader of held.readers) reader(held.value)
}

// The feed. Each frame names one region and one figure, and rotates back
// on so the button keeps having something to apply.
const FEED = [
    { id: 'south', orders: 95 },
    { id: 'north', orders: 130 },
    { id: 'west', orders: 88 },
    { id: 'east', orders: 71 },
]

const list = document.querySelector('#regions')

held.readers.add((byId) => {
    list.replaceChildren(
        ...[...byId.values()].map((region) => {
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

document.querySelector('#apply').addEventListener('click', () => {
    const frame = FEED.shift()
    if (!frame) return
    FEED.push(frame)
    patch((byId) => applyOrderCount(byId, frame))
})

for (const reader of held.readers) reader(held.value)
