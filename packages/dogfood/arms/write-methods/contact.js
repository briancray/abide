const phone = document.querySelector('#phone')
const draft = document.querySelector('#draft')
const tags = document.querySelector('#tags')

function show(contact) {
    phone.textContent = contact.phone
    tags.replaceChildren()
    for (const tag of contact.tags) {
        const item = document.createElement('li')
        const remove = document.createElement('button')
        remove.textContent = `${tag} ✕`
        remove.addEventListener('click', () => write('DELETE', { tag }))
        item.append(remove)
        tags.append(item)
    }
}

async function write(method, args) {
    const inURL = method === 'GET' || method === 'DELETE'
    const query = inURL
        ? `?${new URLSearchParams({ id: '4021', ...args })}`
        : ''
    const answer = await fetch(`/api/contact${query}`, {
        method,
        headers: inURL ? {} : { 'content-type': 'application/json' },
        body: inURL ? undefined : JSON.stringify({ id: '4021', ...args }),
    })
    show(await answer.json())
}

document
    .querySelector('#save')
    .addEventListener('click', () => write('PATCH', { phone: draft.value }))
document
    .querySelector('#reset')
    .addEventListener('click', () =>
        write('PUT', { tags: ['customer', 'newsletter', 'vip'] }),
    )

write('GET', {})
