// THE CHANNEL, WRITTEN BY HAND: the turns so far and the list of
// readers to tell about the next one. Nothing else knows that two
// parts of this page both want it, so both are wired up here.
const rooms = new Map()

function roomFor(conversation) {
    let held = rooms.get(conversation)
    if (!held) {
        held = { turns: [], readers: new Set() }
        rooms.set(conversation, held)
    }
    return held
}

function append(conversation, turn) {
    const room = roomFor(conversation)
    room.turns.push(turn)
    for (const reader of room.readers) reader(room)
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
    const last = room.turns.at(-1)
    speaker.textContent = last ? last.speaker : 'nobody'
    text.textContent = last ? last.text : 'nothing yet'
})

document.querySelector('#send').addEventListener('click', () => {
    append('onboarding', { speaker: 'you', text: draft.value })
})
