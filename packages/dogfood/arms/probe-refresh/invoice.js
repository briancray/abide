const loading = document.querySelector('#loading')
const status = document.querySelector('#status')
const total = document.querySelector('#total')
const sent = document.querySelector('#sent')

// TWO FLAGS, NOT ONE, and telling them apart by hand is the whole
// job: a first load has nothing to show and a reload has, so one
// boolean makes the table blank every time somebody presses
// Refresh. `held` is what says which of the two this is.
let held = null
let inFlight = false

function render() {
    loading.hidden = !(inFlight && held === null)
    status.textContent = inFlight && held !== null ? 'refreshing…' : ''
    total.textContent = held === null ? '' : held.total
    sent.textContent = held === null ? '' : String(held.sent)
}

function load() {
    inFlight = true
    render()
    fetch('/api/invoice?id=4021')
        .then((answer) => answer.json())
        .then((invoice) => {
            held = invoice
            inFlight = false
            render()
        })
}

document.querySelector('#refresh').addEventListener('click', load)

load()
