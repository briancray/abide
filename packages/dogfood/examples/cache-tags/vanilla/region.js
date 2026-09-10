// THE TAG INDEX, WRITTEN BY HAND. An entry table alone cannot answer
// "everything about north", so the tags are a second index beside it —
// and every entry has to be added to both, in both directions, or a
// later invalidate quietly misses it.
const entries = new Map()
const tagged = new Map()

function load(name, tags, address, render) {
    const entry = { address, render }
    entries.set(name, entry)
    for (const tag of tags) {
        if (!tagged.has(tag)) tagged.set(tag, new Set())
        tagged.get(tag).add(name)
    }
    fetchInto(entry)
}

function fetchInto(entry) {
    fetch(entry.address)
        .then((answer) => answer.json())
        .then(entry.render)
}

function invalidate(tag) {
    for (const name of tagged.get(tag) ?? []) fetchInto(entries.get(name))
}

// The two memos of one region declare a tag in common and know nothing
// else about each other, which is what one press has to reach across.
for (const region of ['north', 'south']) {
    const root = document.querySelector(`#${region}`)
    const shown = (name) => root.querySelector(`[data-${name}]`)

    load(
        `totals:${region}`,
        ['metrics', `region:${region}`],
        `/api/totals?region=${region}`,
        (data) => {
            shown('revenue').textContent = String(data.revenue)
            shown('computed').textContent = String(data.computed)
        },
    )

    load(
        `orders:${region}`,
        ['orders', `region:${region}`],
        `/api/orders?region=${region}`,
        (data) => {
            shown('count').textContent = String(data.count)
            shown('loaded').textContent = String(data.loaded)
        },
    )

    shown('reload').addEventListener('click', () => {
        invalidate(`region:${region}`)
    })
}
