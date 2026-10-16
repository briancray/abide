// ONE ENTRY PER KEY, AND A WAY TO SELECT A SLICE OF THEM. The
// table is the easy half; the hard half is that a write knows a
// warehouse and not a key, so reloading "east, whatever the sku"
// means walking every entry and comparing its args by hand.
const entries = new Map()

function keyOf(args) {
    return JSON.stringify(Object.entries(args).sort())
}

function load(args) {
    const query = new URLSearchParams(args)
    return fetch(`/api/stock?${query}`)
        .then((answer) => answer.json())
        .then((level) => {
            entries.set(keyOf(args), { args, level })
            render()
        })
}

function refreshMatching(pattern) {
    for (const held of [...entries.values()]) {
        const matches = Object.entries(pattern).every(
            ([name, value]) => held.args[name] === value,
        )
        if (matches) load(held.args)
    }
}

function render() {
    const east = entries.get(keyOf({ sku: 'A-70', warehouse: 'east' }))
    const west = entries.get(keyOf({ sku: 'A-70', warehouse: 'west' }))
    if (east) {
        document.querySelector('#east').textContent = String(east.level.onHand)
        document.querySelector('#east-loads').textContent = String(
            east.level.loads,
        )
    }
    if (west) {
        document.querySelector('#west-loads').textContent = String(
            west.level.loads,
        )
    }
}

document.querySelector('#book').addEventListener('click', () => {
    fetch('/api/book', { method: 'POST' }).then(() => {
        refreshMatching({ warehouse: 'east' })
    })
})

load({ sku: 'A-70', warehouse: 'east' })
load({ sku: 'A-70', warehouse: 'west' })
