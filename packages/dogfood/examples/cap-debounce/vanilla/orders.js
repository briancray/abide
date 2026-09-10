const field = document.querySelector('#region')
const status = document.querySelector('#status')
const orders = document.querySelector('#orders')

// THE WINDOW, WRITTEN BY HAND, and it is three pieces rather than
// one: the timer that waits for quiet, the flag that keeps the
// held figure on screen while it waits, and the guard that stops
// an answer for a region since typed past from landing.
let timer = null
let held = null
let latest = 0

function render() {
    status.textContent = timer === null ? '' : 'updating…'
    orders.textContent = held === null ? '—' : String(held)
}

function load(region) {
    latest += 1
    const mine = latest
    fetch(`/api/orders?region=${region}`)
        .then((answer) => answer.json())
        .then((count) => {
            if (mine !== latest) return
            held = count
            timer = null
            render()
        })
}

field.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer)
    const region = field.value
    timer = setTimeout(() => load(region), 400)
    render()
})

load(field.value)
render()
