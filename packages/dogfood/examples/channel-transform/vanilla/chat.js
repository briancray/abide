const LIMIT = 120

// THE REFUSAL, WRITTEN BY HAND, and it is a shape rather than a
// type: a caller tells it from a sequence number by looking, and
// nothing checks that a second gate spells it the same way.
function tooLong(length) {
    return {
        name: 'TooLong',
        status: 422,
        message: 'That message is longer than the conversation takes.',
        data: { length },
    }
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

// The gate sits on the way in, so nothing downstream has to re-run
// it — including whatever else comes to publish here later.
function publish(conversation, turn) {
    if (turn.text.length > LIMIT) return tooLong(turn.text.length)
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

const last = document.querySelector('#last')
const refusal = document.querySelector('#refusal')
const draft = document.querySelector('#draft')

subscribe('onboarding', (room) => {
    last.textContent = room.latest ? room.latest.text : 'nothing sent yet'
})

document.querySelector('#send').addEventListener('click', () => {
    const answer = publish('onboarding', { speaker: 'you', text: draft.value })
    refusal.textContent =
        typeof answer === 'number'
            ? ''
            : `${answer.name} at ${answer.data.length} characters`
})
