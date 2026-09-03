// The one value split in two by hand. `shown` is what is on the
// screen; `entries` is the cache behind it. A mark drops the second
// and must not touch the first, which is the whole reason these
// cannot be one variable here — and keeping them in step on every
// other path is what that costs.
const TTL = 30_000
const SKU = 'A-70'
const entries = new Map()

const nav = document.querySelector('#warehouses')
const heading = document.querySelector('#sku')
const line = document.querySelector('#level')
const counted = document.querySelector('#counted')
const spinner = document.querySelector('#reloading')
const mark = document.querySelector('#mark')
const now = document.querySelector('#now')
const book = document.querySelector('#book')

let warehouse = 'east'
let shown
let reloading = false

function keyOf(where) {
    return `${where}/${SKU}`
}

function render() {
    spinner.hidden = !reloading
    for (const control of [mark, now, book]) control.disabled = reloading
    heading.textContent = SKU
    counted.hidden = !shown
    if (!shown) {
        line.textContent = 'Counting the shelf…'
        return
    }
    line.textContent = `On hand ${shown.onHand}`
    counted.textContent = `Counted ${shown.countedOn}`
}

async function load(key) {
    const response = await fetch(`/api/stock/${key}`)
    const value = await response.json()
    entries.set(key, { value, at: Date.now() })
    return value
}

// Stale-while-revalidate needs something to serve, and a mark is
// exactly what takes that away. So this has to ask whether a cache
// is still there and pick a different render either way — the one
// branch that makes a mark followed by a reload blank the page.
async function reload(key) {
    if (entries.has(key)) reloading = true
    else shown = undefined
    render()
    shown = await load(key)
    reloading = false
    render()
}

// A display is where a dropped cache is paid for, and the only
// place allowed to know that.
async function display(key) {
    const entry = entries.get(key)
    if (entry && Date.now() - entry.at < TTL) {
        shown = entry.value
        return render()
    }
    shown = undefined
    render()
    shown = await load(key)
    render()
}

// A mark is a cache drop and nothing else. NOT re-rendering is the
// load-bearing half: what is on screen stays on screen.
mark.addEventListener('click', () => {
    entries.delete(keyOf(warehouse))
})

now.addEventListener('click', () => reload(keyOf(warehouse)))

// The pattern `{ sku }` by hand: a scan of the table for a PARTIAL
// key, the entries being filed under a string and a string not
// being matchable in part. The one being displayed is reloaded and
// the rest are dropped, which is one call there and two arms here.
book.addEventListener('click', async () => {
    const key = keyOf(warehouse)
    await fetch(`/api/stock/${key}`, { method: 'POST' })
    for (const other of entries.keys()) {
        if (other === key || !other.endsWith(`/${SKU}`)) continue
        entries.delete(other)
    }
    reload(key)
})

nav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-warehouse]')
    if (!target) return
    event.preventDefault()
    warehouse = target.dataset.warehouse
    display(keyOf(warehouse))
})

// Bounded by the screen: reload the one being displayed and drop
// the caches behind the rest. One call there, two branches here,
// and the registry of what is on screen is the thing this file
// does not have.
addEventListener('online', () => {
    const key = keyOf(warehouse)
    for (const other of entries.keys()) {
        if (other !== key) entries.delete(other)
    }
    reload(key)
})

render()
display(keyOf(warehouse))
