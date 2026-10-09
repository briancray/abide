const type = document.querySelector('#type')
const body = document.querySelector('#body')

async function load() {
    const answer = await fetch('/api/salesCsv?year=2026')
    type.textContent = answer.headers.get('content-type')
    body.textContent = await answer.text()
}

load()
