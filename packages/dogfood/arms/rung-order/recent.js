const seal = document.querySelector('#seal')
const limit = document.querySelector('#limit')
const status = document.querySelector('#status')
const count = document.querySelector('#count')

// THE SEAL THE RUNG READS, held here because the frame has no cookie
// jar. It is what a caller presents, and the check on it is the first
// thing the route does.
let signedIn = false

function render(answer) {
    seal.textContent = signedIn ? 'Sign out' : 'Sign in'
    status.textContent = answer.name ? `${answer.status} ${answer.message}` : ''
    count.textContent = answer.name ? '—' : String(answer.length)
}

function load() {
    const headers = signedIn ? { authorization: 'Bearer ada' } : {}
    fetch(`/api/searchInvoices?limit=${limit.value}`, { headers })
        .then((answer) => answer.json())
        .then(render)
}

seal.addEventListener('click', () => {
    signedIn = !signedIn
    load()
})

limit.addEventListener('input', load)

load()
