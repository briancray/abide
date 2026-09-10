const total = document.querySelector('#total')
const remind = document.querySelector('#remind')
const status = document.querySelector('#status')

// A PROMISE ANSWERS ONCE, so everything a reader wants to know
// about the call after that has to be tracked beside it: whether
// anything is held, and whether a load is out. The button reads
// both, and neither of them came back from the fetch.
let held = null
let inFlight = false

function render() {
    remind.disabled = held === null
    status.textContent = inFlight && held !== null ? 'reloading…' : ''
    total.textContent = held === null ? '' : held.total
}

function load() {
    inFlight = true
    render()
    fetch('/api/invoices/get?id=4021')
        .then((answer) => answer.json())
        .then((invoice) => {
            held = invoice
            inFlight = false
            render()
        })
}

document.querySelector('#reload').addEventListener('click', load)

load()
