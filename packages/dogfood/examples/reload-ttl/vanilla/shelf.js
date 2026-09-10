const TTL = 3000

const onHand = document.querySelector('#onhand')
const loadsOut = document.querySelector('#loads')

// EXPIRY ON THE READ, NOT ON A TIMER. A `setTimeout` per entry
// would drop the value with nobody asking — and paying for
// retention on a schedule is exactly what makes a deep ring
// expensive. So the stamp is checked when somebody looks.
let held = null
let storedAt = 0
let inFlight = false

function render() {
    onHand.textContent = held === null ? 'counting…' : String(held.onHand)
    loadsOut.textContent = held === null ? '' : String(held.loads)
}

function read() {
    const lapsed = held !== null && Date.now() - storedAt >= TTL
    if (held !== null && !lapsed) return
    if (inFlight) return
    inFlight = true
    fetch('/api/stock?warehouse=east&sku=A-70')
        .then((answer) => answer.json())
        .then((level) => {
            held = level
            storedAt = Date.now()
            inFlight = false
            render()
        })
}

document.querySelector('#again').addEventListener('click', read)

read()
render()
