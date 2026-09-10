let contact = null
let pending = true

// THE UNWRAP, BY HAND. What the fetch hands back is a promise, so
// every read of the record is guarded, and the guard is the same
// line wherever it is shown.
function render() {
    document.querySelector('#name').textContent = contact?.name ?? '—'
    document.querySelector('#role').textContent = contact?.role ?? '—'
    document.querySelector('#status').textContent = pending ? 'loading…' : ''
}

async function load() {
    const response = await fetch('/api/contact?id=42')
    contact = await response.json()
    pending = false
    render()
}

render()
load()
