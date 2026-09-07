const TOTAL = 12
const MATCHING = { all: 12, customers: 4, leads: 1 }

let filter = 'all'
let label = '…'
let stale = '…'

const count = (of) =>
    new Promise((done) => setTimeout(() => done(MATCHING[of] ?? 0), 200))

// NOTHING HERE IS TRACKED EITHER WAY, so the two arms differ in
// the one thing this card is about: which of them is re-run. The
// subscription is the call below, written by hand — and writing
// it by hand is exactly why the second one gets forgotten.
async function runLabel() {
    const of = filter
    label = `showing ${await count(of)} of ${TOTAL}`
    render()
}

async function runStale() {
    const found = await count(filter)
    stale = `showing ${found} of ${TOTAL}`
    render()
}

function render() {
    document.querySelector('#label').textContent = label
    document.querySelector('#stale').textContent = stale
}

document.querySelector('#filter').addEventListener('change', (event) => {
    filter = event.target.value
    // The first label's read is in the graph, so it re-runs. The
    // second one's is not, and this is the call that is missing.
    runLabel()
    render()
})

runLabel()
runStale()
