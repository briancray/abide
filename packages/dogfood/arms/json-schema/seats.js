const seats = document.querySelector('#seats')
const message = document.querySelector('#message')

// THE BOUNDS, AS A SECOND COPY. A JSON Schema document published for the
// API says the same thing, and nothing compares the two.
const MINIMUM = 1
const MAXIMUM = 50

let held = 48

function write(next) {
    if (next > MAXIMUM) {
        message.textContent = `must be at most ${MAXIMUM}`
        return
    }
    if (next < MINIMUM) {
        message.textContent = `must be at least ${MINIMUM}`
        return
    }
    message.textContent = ''
    held = next
    seats.textContent = String(held)
}

document.querySelector('#more').addEventListener('click', () => write(held + 1))
document
    .querySelector('#fewer')
    .addEventListener('click', () => write(held - 1))
