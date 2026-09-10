const counting = document.querySelector('#counting')
const figures = document.querySelector('#figures')
const onHand = document.querySelector('#onhand')
const counted = document.querySelector('#counted')

// STALE IS A THIRD STATE, and it is the one a hand-written cache
// usually does not have: `held` says what CAN be served and
// `stale` says whether it MAY be. Collapse the two and marking
// something stale either blanks the page or does nothing at all.
let held = null
let stale = false
let inFlight = false
let loads = 0

// A load with nothing trustworthy underneath it. That is a first
// load, and it is also a reload over something already marked
// wrong — which is why the two triggers in that order blank.
function pending() {
    return inFlight && (held === null || stale)
}

function render() {
    counting.hidden = !pending()
    figures.hidden = pending()
    if (held === null) return
    onHand.textContent = String(held.onHand)
    counted.textContent = String(loads)
}

function load() {
    loads += 1
    inFlight = true
    render()
    fetch('/api/stock?warehouse=east&sku=A-70')
        .then((answer) => answer.json())
        .then((level) => {
            held = level
            stale = false
            inFlight = false
            render()
        })
}

// Marks the cache stale and loads nothing. Nothing is re-rendered,
// so what is on screen stays exactly as it was.
document.querySelector('#stale').addEventListener('click', () => {
    stale = true
})

// Loads now. What is held keeps being served meanwhile — unless
// something already said it was wrong.
document.querySelector('#reload').addEventListener('click', load)

load()
