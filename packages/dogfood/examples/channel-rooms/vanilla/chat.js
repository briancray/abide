// ONE ROOM PER ARGS KEY, WRITTEN BY HAND — the canonical form of
// the key included, because two spellings of one key are two rooms
// and neither of them is the one the other half of the app is in.
const rooms = new Map()

function keyOf(args) {
    return JSON.stringify(Object.entries(args).sort())
}

function roomFor(args) {
    const key = keyOf(args)
    let held = rooms.get(key)
    if (!held) {
        held = { latest: undefined, seq: 0, readers: new Set() }
        rooms.set(key, held)
    }
    return held
}

function publish(args, turn) {
    const room = roomFor(args)
    room.seq += 1
    room.latest = turn
    for (const reader of room.readers) reader(room)
    return room.seq
}

function subscribe(args, reader) {
    const room = roomFor(args)
    room.readers.add(reader)
    reader(room)
    return () => room.readers.delete(reader)
}

const conversation = document.querySelector('#conversation')
const last = document.querySelector('#last')
const draft = document.querySelector('#draft')

let here = 'onboarding'
// The room changed, so the old subscription has to go and a new one
// has to be taken out — by hand, in the right order, every time.
let unsubscribe = () => {}

function show(name) {
    unsubscribe()
    here = name
    conversation.textContent = name
    unsubscribe = subscribe({ conversation: name }, (room) => {
        last.textContent = room.latest ? room.latest.text : 'nothing here yet'
    })
}

document.querySelector('#send').addEventListener('click', () => {
    publish({ conversation: here }, { speaker: 'you', text: draft.value })
})

for (const link of document.querySelectorAll('[data-conversation]')) {
    link.addEventListener('click', (event) => {
        event.preventDefault()
        for (const other of document.querySelectorAll('[data-conversation]')) {
            other.removeAttribute('aria-current')
        }
        link.setAttribute('aria-current', 'page')
        show(link.dataset.conversation)
    })
}

show('onboarding')
