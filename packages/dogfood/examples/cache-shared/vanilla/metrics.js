// THE ENTRY TABLE, WRITTEN BY HAND, and the part that is easy to leave
// out is the IN-FLIGHT case: the entry goes into the table BEFORE the
// answer lands, so a second panel asking on the same tick joins the load
// rather than starting one. Hold the ANSWER instead and two readers who
// ask before it arrives both miss.
const entries = new Map()

function entryFor(range) {
    const held = entries.get(range)
    if (held) return held
    const entry = { metrics: null }
    entries.set(range, entry)
    fetch(`/api/metrics?range=${range}`)
        .then((answer) => answer.json())
        .then((metrics) => {
            entry.metrics = metrics
            render()
        })
    return entry
}

// The two panels never speak to each other. Each holds a range of its
// own and asks the table for it.
const PANELS = [
    { id: 'total', field: 'orders', range: '7d', entry: null },
    { id: 'average', field: 'average', range: '7d', entry: null },
]

function render() {
    for (const panel of PANELS) {
        const root = document.querySelector(`#${panel.id}`)
        const metrics = panel.entry.metrics
        root.querySelector('[data-value]').textContent = metrics
            ? String(metrics[panel.field])
            : '—'
        root.querySelector('[data-computed]').textContent = metrics
            ? String(metrics.computed)
            : '—'
        for (const button of root.querySelectorAll('[data-range]')) {
            button.ariaSelected = String(button.dataset.range === panel.range)
        }
    }
}

for (const panel of PANELS) {
    const root = document.querySelector(`#${panel.id}`)
    for (const button of root.querySelectorAll('[data-range]')) {
        button.addEventListener('click', () => {
            panel.range = button.dataset.range
            panel.entry = entryFor(panel.range)
            render()
        })
    }
    panel.entry = entryFor(panel.range)
}

render()
