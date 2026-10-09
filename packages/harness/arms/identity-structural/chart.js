const north = document.querySelector('#north')
const south = document.querySelector('#south')
const redraws = document.querySelector('#redraws')

// THE COMPARISON IS WRITTEN PER SHAPE: every load hands back a new
// object, so the chart would redraw on each one unless the fields
// are checked against the last ones by hand — and a field added to
// the record later is a field this forgets.
let sales
let drawn = 0

async function load() {
    const next = await (await fetch('/api/sales')).json()
    const same =
        sales !== undefined &&
        next.north === sales.north &&
        next.south === sales.south
    if (same) return
    sales = next
    north.textContent = String(sales.north)
    south.textContent = String(sales.south)
    drawn += 1
    redraws.textContent = String(drawn)
}

document.querySelector('#refresh').addEventListener('click', load)

document.querySelector('#sale').addEventListener('click', async () => {
    await fetch('/api/sale', { method: 'POST' })
    await load()
})

load()
