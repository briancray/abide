const message = document.querySelector('#message')
const total = document.querySelector('#total')

// THE THIRD VARIABLE. A value, a loading flag and a failure, kept
// in step by hand — and the one that goes wrong is CLEARING it: a
// retry that forgets leaves the last failure on screen under the
// new answer, and nothing about that reads as a bug.
let held = null
let failure = null

function render() {
    message.hidden = failure === null
    message.textContent = failure === null ? '' : failure.message
    total.textContent = failure !== null ? 'unavailable' : (held?.total ?? '')
}

function load() {
    fetch('/api/invoice?id=4021')
        .then((answer) => answer.json())
        .then((body) => {
            if (body.name === 'NotReachable') {
                failure = body
            } else {
                failure = null
                held = body
            }
            render()
        })
}

document.querySelector('#retry').addEventListener('click', load)

load()
