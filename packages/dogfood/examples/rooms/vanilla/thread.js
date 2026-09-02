// The room the framework gives you: a subject with a tail, a seq,
// and a subscriber list — one per thread id, written by hand.
const rooms = new Map()
const TAIL = 50

function room(id) {
    let held = rooms.get(id)
    if (!held) {
        held = { messages: [], seq: 0, readers: new Set() }
        rooms.set(id, held)
    }
    return held
}

function publish(id, message) {
    const here = room(id)
    if (message.text.length > 500) return { name: 'TooLong' }
    here.seq += 1
    here.messages.push({ ...message, seq: here.seq })
    if (here.messages.length > TAIL) here.messages.shift()
    for (const reader of here.readers) reader(here)
    return here.seq
}

function subscribe(id, reader) {
    const here = room(id)
    here.readers.add(reader)
    reader(here)
    return () => here.readers.delete(here)
}

const list = document.querySelector('#posts')
const latest = document.querySelector('#latest')
const input = document.querySelector('#text')
const count = document.querySelector('#count')
const post = document.querySelector('#post')

let current = 'general'
let unsubscribeList = () => {}
let unsubscribeLatest = () => {}

function show(id) {
    unsubscribeList()
    unsubscribeLatest()
    current = id
    document.querySelector('#title').textContent = `#${id}`
    // Two readers of one room, each wired up by hand because
    // nothing else knows they both want it.
    unsubscribeList = subscribe(id, (here) => {
        list.replaceChildren(
            ...here.messages.map((message) => {
                const item = document.createElement('li')
                item.innerHTML = `<b>${message.author}</b> ${message.text}`
                return item
            }),
        )
    })
    unsubscribeLatest = subscribe(id, (here) => {
        const last = here.messages[here.messages.length - 1]
        latest.textContent = last ? `latest from ${last.author}` : ''
    })
}

input.addEventListener('input', () => {
    count.textContent = String(input.value.length)
})

post.addEventListener('click', () => {
    publish(current, { author: 'ada', text: input.value })
    input.value = ''
    count.textContent = '0'
})

for (const link of document.querySelectorAll('[data-room]')) {
    link.addEventListener('click', (event) => {
        event.preventDefault()
        for (const other of document.querySelectorAll('[data-room]')) {
            other.removeAttribute('aria-current')
        }
        link.setAttribute('aria-current', 'page')
        show(link.dataset.room)
    })
}

show('general')
