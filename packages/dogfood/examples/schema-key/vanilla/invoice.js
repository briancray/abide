const status = document.querySelector('#status')
const ref = document.querySelector('#ref')

const SPELLINGS = [
    ['#upper', 'ABC-123'],
    ['#lower', 'abc-123'],
]

// THE ENTRY TABLE, KEYED BY THE ARGUMENTS AS SENT. Normalising
// before the key would collapse these two onto one entry, and then
// a page rendered on the server keys one way and the browser the
// other — so every load runs a second time on hydration.
const entries = new Map()

let id = 'ABC-123'

function render() {
    const entry = entries.get(id)
    status.textContent = entry?.pending ? 'loading…' : ''
    ref.textContent = entry?.invoice?.ref ?? '—'
    for (const [button, one] of SPELLINGS) {
        document.querySelector(button).ariaSelected = String(one === id)
    }
}

function open(next) {
    id = next
    if (!entries.has(next)) {
        const entry = { invoice: null, pending: true }
        entries.set(next, entry)
        fetch(`/api/getInvoice?id=${next}`)
            .then((answer) => answer.json())
            .then((invoice) => {
                entry.invoice = invoice
                entry.pending = false
                render()
            })
    }
    render()
}

for (const [button, one] of SPELLINGS) {
    document.querySelector(button).addEventListener('click', () => open(one))
}

open(id)
