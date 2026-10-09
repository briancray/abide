const tabs = document.querySelectorAll('[data-person]')
const status = document.querySelector('#status')
const copied = document.querySelector('#copied')

// "NOT HERE YET" IS A SENTINEL the arm has to invent and then check
// everywhere the value is read — a missing map entry here, kept
// apart by hand from a contact that loaded with no email.
const contacts = new Map()
let open = 'ada'

async function load(id) {
    open = id
    for (const tab of tabs)
        tab.setAttribute('aria-selected', String(tab.dataset.person === id))
    copied.textContent = '—'
    if (contacts.has(id)) return
    status.textContent = 'loading…'
    const response = await fetch(`/api/contact?id=${id}`)
    contacts.set(id, await response.json())
    if (open === id) status.textContent = ''
}

for (const tab of tabs)
    tab.addEventListener('click', () => load(tab.dataset.person))

document.querySelector('#copy').addEventListener('click', () => {
    const contact = contacts.get(open)
    copied.textContent = contact === undefined ? 'still loading' : contact.email
})

load('ada')
