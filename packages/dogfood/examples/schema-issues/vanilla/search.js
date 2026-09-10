const query = document.querySelector('#query')
const limit = document.querySelector('#limit')
const matches = document.querySelector('#matches')

const FIELDS = [
    ['query', document.querySelector('#query-issue')],
    ['limit', document.querySelector('#limit-issue')],
]

function render(answer) {
    const issues = answer.name === 'ValidationError' ? answer.data : {}
    for (const [field, node] of FIELDS) {
        const found = issues[field] ?? []
        node.hidden = found.length === 0
        node.textContent = found[0] ?? ''
    }
    matches.textContent = answer.name ? '—' : String(answer.length)
}

function search() {
    const address = `/api/searchInvoices?query=${query.value}&limit=${limit.value}`
    fetch(address)
        .then((answer) => answer.json())
        .then(render)
}

for (const field of [query, limit]) field.addEventListener('input', search)

search()
