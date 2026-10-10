const TAIL = 3

const OPENING = [
    { speaker: 'you', text: 'How do I rotate an API key?' },
    { speaker: 'assistant', text: 'Settings, then Keys, then Rotate.' },
    { speaker: 'you', text: 'Does the old key keep working?' },
]

// THE ROOM, WRITTEN BY HAND: appended to and trimmed in the same
// write, so every reader sees the window the room keeps.
const rooms = new Map()

function roomFor(conversation) {
    let held = rooms.get(conversation)
    if (!held) {
        held = { messages: [], readers: new Set() }
        rooms.set(conversation, held)
    }
    return held
}

function say(conversation, turn) {
    const room = roomFor(conversation)
    room.messages.push(turn)
    if (room.messages.length > TAIL) room.messages.shift()
    for (const reader of room.readers) reader(room)
}

function follow(conversation, reader) {
    const room = roomFor(conversation)
    const send = () => reader(room.messages)
    room.readers.add(send)
    send()
    return () => room.readers.delete(send)
}

const transcript = document.querySelector('#transcript')
const draft = document.querySelector('#draft')

for (const turn of OPENING) say('onboarding', turn)

follow('onboarding', (messages) => {
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
    say('onboarding', { speaker: 'you', text: draft.value })
})
