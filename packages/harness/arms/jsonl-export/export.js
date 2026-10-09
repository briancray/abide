const type = document.querySelector('#type')
const body = document.querySelector('#body')

async function load() {
    const answer = await fetch('/api/salesForWarehouse?day=2026-10-07')
    type.textContent = answer.headers.get('content-type')
    body.textContent = await answer.text()
}

document.querySelector('#again').addEventListener('click', load)

load()
