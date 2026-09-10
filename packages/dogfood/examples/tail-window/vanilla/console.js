const TAIL = 4

const WORDS = ['Rotate', 'the', 'key', 'in', 'Settings', 'then', 'Keys.']

// THE RING, WRITTEN BY HAND — and the trim is the part that is
// easy to leave out, because nothing about a growing array looks
// wrong until the tab has been open all afternoon.
const held = []

function produce(line) {
    held.push(line)
    if (held.length > TAIL) held.shift()
    render()
}

const list = document.querySelector('#console')

// The reader asks for fifty and gets what the ring kept — what a
// reader may ask for is capped by the value, not by the reader.
function render() {
    list.replaceChildren(
        ...held.slice(-50).map((line) => {
            const row = document.createElement('li')
            const at = document.createElement('span')
            at.textContent = String(line.at)
            const text = document.createElement('p')
            text.textContent = line.text
            row.append(at, text)
            return row
        }),
    )
}

let sent = 0
document.querySelector('#emit').addEventListener('click', () => {
    sent += 1
    produce({ at: sent, text: WORDS[sent % WORDS.length] ?? '…' })
})
