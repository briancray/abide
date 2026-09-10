const held = []
const readers = new Set()

function produce(line) {
    held.push(line)
    for (const reader of readers) reader(line)
}

// TWO CURSORS OVER ONE VALUE, and the only difference between them
// is what they are handed to start with. A reader that replays
// gets a slice of the ring first and then the same arrivals; a
// live one is handed nothing and starts where it joined.
function open(want, paint) {
    const seen = want === 0 ? [] : held.slice(-want)
    paint(seen)
    const reader = (line) => {
        seen.push(line)
        paint(seen)
    }
    readers.add(reader)
    return () => readers.delete(reader)
}

const replay = document.querySelector('#replay')
const live = document.querySelector('#live')

let sent = 0
for (const at of [1, 2, 3]) {
    sent = at
    held.push({ at, text: `token ${at}` })
}

open(3, (seen) => {
    replay.textContent = seen.map((line) => line.at).join(' ')
})

open(0, (seen) => {
    live.textContent = seen.map((line) => line.at).join(' ')
})

document.querySelector('#emit').addEventListener('click', () => {
    sent += 1
    produce({ at: sent, text: `token ${sent}` })
})
