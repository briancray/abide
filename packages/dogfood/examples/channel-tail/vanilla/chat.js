const TAIL = 3

const OPENING = [
    { speaker: 'you', text: 'How do I rotate an API key?' },
    { speaker: 'assistant', text: 'Settings, then Keys, then Rotate.' },
    { speaker: 'you', text: 'Does the old key keep working?' },
]

// THE RING, WRITTEN BY HAND: appended to and trimmed on every
// publish, so what a reader asks for is capped by the room and not
// by the reader.
const rooms = new Map()

function roomFor(conversation) {
    let held = rooms.get(conversation)
    if (!held) {
        held = { messages: [], seq: 0, readers: new Set() }
        rooms.set(conversation, held)
    }
    return held
}

function publish(conversation, turn) {
    const room = roomFor(conversation)
    room.seq += 1
    room.messages.push(turn)
    if (room.messages.length > TAIL) room.messages.shift()
    for (const reader of room.readers) reader(room)
    return room.seq
}

function tail(conversation, want, reader) {
    const room = roomFor(conversation)
    const send = () => reader(room.messages.slice(-want))
    room.readers.add(send)
    send()
    return () => room.readers.delete(send)
}

const transcript = document.querySelector('#transcript')
const draft = document.querySelector('#draft')

for (const turn of OPENING) publish('onboarding', turn)

tail('onboarding', 50, (messages) => {
    transcript.replaceChildren(
        ...messages.map((turn) => {
            const row = document.createElement('li')
            row.dataset.speaker = turn.speaker
            const who = document.createElement('span')
            who.textContent = turn.speaker
            const said = document.createElement('p')
            said.textContent = turn.text
            row.append(who, said)
            return row
        }),
    )
})

document.querySelector('#send').addEventListener('click', () => {
    publish('onboarding', { speaker: 'you', text: draft.value })
})
