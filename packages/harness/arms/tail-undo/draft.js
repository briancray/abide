const TAIL = 50

const field = document.querySelector('#draft')

// EACH ENTRY HAS TO BE A DISTINCT VALUE or replay hands back what
// is already on screen. Strings are copied for free; a record
// would have to be copied down the path being written.
const held = ['How do']

function produce(value) {
    held.push(value)
    if (held.length > TAIL) held.shift()
}

// THE POSITION LIVES OUT HERE, over a snapshot, because the write
// below appends to the same ring the walk is reading.
let history = []
let at = 0
let handed

function back() {
    if (field.value !== handed) {
        history = held.slice()
        at = history.length - 1
    }
    if (at > 0) at -= 1
    handed = history[at]
    return handed
}

field.addEventListener('input', () => {
    produce(field.value)
})

document.querySelector('#undo').addEventListener('click', () => {
    field.value = back()
    produce(field.value)
})
