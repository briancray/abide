const asked = document.querySelector('#asked')
const avatar = document.querySelector('#avatar')
const tabs = {
    4021: document.querySelector('#ada'),
    4022: document.querySelector('#grace'),
}

function show(id) {
    for (const [each, tab] of Object.entries(tabs))
        tab.setAttribute('aria-selected', String(each === id))
    const address = `/api/avatar?id=${id}`
    asked.textContent = address
    avatar.src = address
}

tabs['4021'].addEventListener('click', () => show('4021'))
tabs['4022'].addEventListener('click', () => show('4022'))

show('4021')
