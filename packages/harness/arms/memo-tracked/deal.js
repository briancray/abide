const SEAT_PRICE = 25

let seats = 2

// THE DEPENDENCY, WRITTEN BY HAND. Without the guard the total is
// worked out on every render — which nothing on the page would
// show, and which is the claim the spec holds instead.
let ranFor = null
let value = 0

function total() {
    if (ranFor === seats) return value
    ranFor = seats
    value = seats * SEAT_PRICE
    return value
}

function render() {
    document.querySelector('#seats').textContent = String(seats)
    document.querySelector('#total').textContent = `$${total()}`
}

for (const [id, step] of [
    ['#more', 1],
    ['#fewer', -1],
]) {
    document.querySelector(id).addEventListener('click', () => {
        seats = Math.max(0, seats + step)
        render()
    })
}

render()
