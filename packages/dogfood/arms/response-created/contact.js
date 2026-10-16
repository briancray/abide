const name = document.querySelector('#name')
const status = document.querySelector('#status')
const created = document.querySelector('#location')

async function add() {
    const answer = await fetch('/api/addContact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.value }),
    })
    status.textContent = String(answer.status)
    created.textContent = answer.headers.get('location')
}

document.querySelector('#add').addEventListener('click', add)
