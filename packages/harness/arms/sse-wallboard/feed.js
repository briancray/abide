const type = document.querySelector('#type')
const body = document.querySelector('#body')

async function ask() {
    const answer = await fetch('/api/visits')
    type.textContent = answer.headers.get('content-type')
    body.textContent = await answer.text()
}

document.querySelector('#again').addEventListener('click', ask)

ask()
