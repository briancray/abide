let person = null
let inFlight = true

const field = document.querySelector('#draft')

// THE RE-SEED, WRITTEN BY HAND: the field holds the draft, and
// this is the one call site that has to remember to refill it
// when an answer lands. Forget the call and the box is stale;
// put it in a render and every keystroke is thrown away.
function refill() {
    field.value = person?.name ?? ''
}

function statusOf() {
    if (!inFlight) return ''
    return person ? 'refreshing…' : 'loading…'
}

function render() {
    document.querySelector('#status').textContent = statusOf()
}

async function load() {
    inFlight = true
    render()
    const response = await fetch('/api/person?id=42')
    person = await response.json()
    inFlight = false
    refill()
    render()
}

document.querySelector('#reload').addEventListener('click', load)

load()
