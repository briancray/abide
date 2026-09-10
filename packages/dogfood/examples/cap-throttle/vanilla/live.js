const feed = document.querySelector('#feed')
const tile = document.querySelector('#tile')

let received = 0

// THE WINDOW, WRITTEN BY HAND, and the trailing edge is the part
// that gets left out: without it the tile keeps whatever arrived
// last before the window closed and never catches up to the final
// value, which looks like a stall rather than a cap.
let openedAt = 0
let trailing = null

function paint() {
    tile.textContent = String(received)
    openedAt = Date.now()
}

function show() {
    const since = Date.now() - openedAt
    if (since >= 500) {
        if (trailing !== null) {
            clearTimeout(trailing)
            trailing = null
        }
        paint()
        return
    }
    if (trailing !== null) return
    trailing = setTimeout(() => {
        trailing = null
        paint()
    }, 500 - since)
}

setInterval(() => {
    received += 1
    feed.textContent = String(received)
    show()
}, 50)
