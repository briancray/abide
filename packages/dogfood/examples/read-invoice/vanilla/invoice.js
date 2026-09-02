const heading = document.querySelector('#number')
const line = document.querySelector('#line')

async function load(id) {
    const response = await fetch(`/api/invoices/${id}`)
    if (!response.ok) {
        line.textContent = 'Could not load that invoice.'
        return
    }
    const invoice = await response.json()
    heading.textContent = `Invoice ${invoice.number}`
    line.textContent = `${invoice.total} due ${invoice.dueOn}`
}

load(new URL(location.href).pathname.split('/').pop())
