const status = document.querySelector('#status')
const manager = document.querySelector('#manager')
const tabs = {
    4021: document.querySelector('#ada'),
    4022: document.querySelector('#grace'),
}

async function show(id) {
    for (const [each, tab] of Object.entries(tabs))
        tab.setAttribute('aria-selected', String(each === id))
    const answer = await fetch(`/api/accountManager?id=${id}`)
    const body = await answer.json()
    status.textContent = String(answer.status)
    manager.textContent = body === null ? 'null' : body.name
}

tabs['4021'].addEventListener('click', () => show('4021'))
tabs['4022'].addEventListener('click', () => show('4022'))

show('4021')
