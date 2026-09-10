function identity(turn) {
    return `${turn.speaker}: ${turn.text}`
}

const rooms = new Map()

function roomFor(conversation) {
    let held = rooms.get(conversation)
    if (!held) {
        held = { latest: undefined, seq: 0, readers: new Set() }
        rooms.set(conversation, held)
    }
    return held
}

// A REPEAT IS THE PREVIOUS MESSAGE'S BUSINESS ALONE. Scanning what
// the room still holds would make a resend of anything ever said a
// duplicate, and a retry is not that.
function publish(conversation, turn) {
    const room = roomFor(conversation)
    const same = room.latest && identity(room.latest) === identity(turn)
    if (same) return room.seq
    room.seq += 1
    room.latest = turn
    for (const reader of room.readers) reader(room)
    return room.seq
}

function subscribe(conversation, reader) {
    const room = roomFor(conversation)
    room.readers.add(reader)
    reader(room)
    return () => room.readers.delete(reader)
}

const cursor = document.querySelector('#cursor')
const last = document.querySelector('#last')
const draft = document.querySelector('#draft')

subscribe('onboarding', (room) => {
    last.textContent = room.latest ? room.latest.text : 'nothing sent yet'
})

document.querySelector('#send').addEventListener('click', () => {
    cursor.textContent = String(
        publish('onboarding', { speaker: 'you', text: draft.value }),
    )
})
