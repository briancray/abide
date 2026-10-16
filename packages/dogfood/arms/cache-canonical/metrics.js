// THE CANONICAL FORM, WRITTEN BY HAND, and it is the whole reason three
// spellings of one query are one request: sort the keys, drop the members
// that are `undefined`, and only then build the key. Skip it and the table
// splits on argument order, which nothing about the page would show you.
function keyOf(args) {
    const pairs = []
    for (const name of Object.keys(args).sort()) {
        if (args[name] !== undefined) pairs.push([name, args[name]])
    }
    return JSON.stringify(pairs)
}

const entries = new Map()

function entryFor(args) {
    const key = keyOf(args)
    const held = entries.get(key)
    if (held) return held
    const entry = { metrics: null }
    entries.set(key, entry)
    const query = new URLSearchParams()
    for (const [name, value] of JSON.parse(key)) query.set(name, value)
    fetch(`/api/metrics?${query}`)
        .then((answer) => answer.json())
        .then((metrics) => {
            entry.metrics = metrics
            render()
        })
    return entry
}

function spelled(name, region) {
    if (name === 'range first') return { range: '7d', region }
    if (name === 'region first') return { region, range: '7d' }
    return { region, range: '7d', compare: undefined }
}

const spellings = document.querySelectorAll('[data-spelling]')
const regions = document.querySelectorAll('[data-region]')
const orders = document.querySelector('#orders')
const computed = document.querySelector('#computed')

let spelling = 'range first'
let region = 'north'
let entry = null

function render() {
    const metrics = entry.metrics
    orders.textContent = metrics ? String(metrics.orders) : '—'
    computed.textContent = metrics ? String(metrics.computed) : '—'
    for (const button of spellings) {
        button.ariaSelected = String(button.dataset.spelling === spelling)
    }
    for (const button of regions) {
        button.ariaSelected = String(button.dataset.region === region)
    }
}

function ask() {
    entry = entryFor(spelled(spelling, region))
    render()
}

for (const button of spellings) {
    button.addEventListener('click', () => {
        spelling = button.dataset.spelling
        ask()
    })
}

for (const button of regions) {
    button.addEventListener('click', () => {
        region = button.dataset.region
        ask()
    })
}

ask()
