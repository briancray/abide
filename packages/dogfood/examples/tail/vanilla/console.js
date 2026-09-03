// The ring the number replaces, and the two things that come with
// owning one: a head to write at, and a rotation to read it back
// in the order it was written.
const RETAIN = 200
const REPLAY = 50
const ring = new Array(RETAIN)
let written = 0

const list = document.querySelector('#lines')
const field = document.querySelector('#filter')
const undo = document.querySelector('#undo')
const redo = document.querySelector('#redo')
const copy = document.querySelector('#copy')

// The history a state's own productions would have been, kept by
// hand — and the index that has to live outside it, because an
// undo is itself a write and would otherwise append to the array
// it is walking.
const history = ['']
let at = 0

function push(line) {
    ring[written % RETAIN] = line
    written += 1
}

// Replay depth is `min(n, retained)`, and the rotation is what
// hands the ring back in order.
function tail(depth) {
    const take = Math.min(depth, written, RETAIN)
    const out = []
    for (let step = take; step > 0; step -= 1) {
        out.push(ring[(written - step) % RETAIN])
    }
    return out
}

function render() {
    const query = field.value
    const rows = []
    for (const line of tail(REPLAY)) {
        if (!line.text.includes(query)) continue
        const row = document.createElement('pre')
        row.textContent = line.text
        rows.push(row)
    }
    list.replaceChildren(...rows)
}

const socket = new WebSocket('/api/logs')

socket.addEventListener('message', (event) => {
    push(JSON.parse(event.data))
    render()
})

field.addEventListener('input', () => {
    history.length = at + 1
    history.push(field.value)
    at = history.length - 1
    render()
})

undo.addEventListener('click', () => {
    if (at === 0) return
    at -= 1
    field.value = history[at]
    render()
})

redo.addEventListener('click', () => {
    if (at === history.length - 1) return
    at += 1
    field.value = history[at]
    render()
})

copy.addEventListener('click', () => {
    const text = tail(10)
        .map((line) => line.text)
        .join('\n')
    navigator.clipboard.writeText(text)
})

render()
