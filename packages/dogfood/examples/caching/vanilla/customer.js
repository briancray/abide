// The cache the framework does not have here: an entry per args
// key, its own in-flight table so two readers are one request, and
// an expiry, all of it written by hand.
const entries = new Map()
const inFlight = new Map()
const TTL = 30_000

function key(args) {
    return JSON.stringify(Object.fromEntries(Object.entries(args).sort()))
}

async function load(path, args) {
    const id = path + key(args)
    const held = entries.get(id)
    if (held && Date.now() - held.at < TTL) return held.value
    if (inFlight.has(id)) return inFlight.get(id)

    const query = new URLSearchParams(args).toString()
    const request = fetch(`/api/${path}?${query}`)
        .then((response) => response.json())
        .then((value) => {
            entries.set(id, { value, at: Date.now() })
            inFlight.delete(id)
            return value
        })
    inFlight.set(id, request)
    return request
}

const heading = document.querySelector('#name')
const plan = document.querySelector('#plan')
const balance = document.querySelector('#balance')

async function show(id) {
    heading.textContent = ''
    plan.textContent = ''
    balance.textContent = ''
    // Two readers of the same customer, coalesced by the table above.
    const [customer, alsoCustomer, rate] = await Promise.all([
        load('customer', { id }),
        load('customer', { id }),
        load('rate', { pair: 'USDEUR' }),
    ])
    heading.textContent = customer.name
    plan.textContent = `Plan: ${alsoCustomer.plan}`
    balance.textContent =
        `Balance ${customer.balance} USD, about ` +
        `${(customer.balance * rate.rate).toFixed(2)} EUR`
}

for (const link of document.querySelectorAll('[data-customer]')) {
    link.addEventListener('click', (event) => {
        event.preventDefault()
        for (const other of document.querySelectorAll('[data-customer]')) {
            other.removeAttribute('aria-current')
        }
        link.setAttribute('aria-current', 'page')
        show(link.dataset.customer)
    })
}

show('42')
