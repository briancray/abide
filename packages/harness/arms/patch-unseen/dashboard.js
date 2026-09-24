function applyOrderCount(byId, frame) {
    const held = byId.get(frame.id)
    if (held) held.orders = frame.orders
}

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

// THE SAME MAP AND THE SAME FOLD, reached without `patch`. Nothing here
// is a cast or an escape hatch: the helper takes the table it was always
// going to take, and changes it. What it never does is mint a production,
// so the readers above go on holding the figure they last painted.
document.querySelector('#apply-unseen').addEventListener('click', () => {
    const frame = FEED.shift()
    if (!frame) return
    FEED.push(frame)
    applyOrderCount(held.value, frame)
})

for (const reader of held.readers) reader(held.value)
