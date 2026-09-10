// THE ROOM, WRITTEN BY HAND: a latest message and the list of
// readers to tell about the next one. Nothing else knows that two
// parts of this page both want it, so both are wired up here.
const rooms = new Map()

function roomFor(conversation) {
    let held = rooms.get(conversation)
    if (!held) {
        held = { latest: undefined, seq: 0, readers: new Set() }
        rooms.set(conversation, held)
    }
    return held
}

function publish(conversation, turn) {
    const room = roomFor(conversation)
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

const speaker = document.querySelector('#speaker')
const text = document.querySelector('#text')
const draft = document.querySelector('#draft')

subscribe('onboarding', (room) => {
    speaker.textContent = room.latest ? room.latest.speaker : 'nobody'
    text.textContent = room.latest ? room.latest.text : 'nothing yet'
})

document.querySelector('#send').addEventListener('click', () => {
    publish('onboarding', { speaker: 'you', text: draft.value })
})
