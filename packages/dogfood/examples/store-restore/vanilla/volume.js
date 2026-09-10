const out = document.querySelector('#volume')

// THE TWO HALVES, WRITTEN BY HAND AND KEPT IN STEP BY HAND. The
// restore has to run before the fallback is shown or the page
// paints 4 and then corrects itself, and the persist has to run
// after every write — including the ones added later.
let volume = 4

function render() {
    out.textContent = String(volume)
}

function persist() {
    fetch('/api/setting', {
        method: 'POST',
        body: JSON.stringify({ name: 'volume', value: volume }),
    })
}

function restore() {
    return fetch('/api/setting?name=volume')
        .then((answer) => answer.json())
        .then((stored) => {
            if (stored !== null) volume = stored
            render()
        })
}

for (const [id, step] of [
    ['#up', 1],
    ['#down', -1],
]) {
    document.querySelector(id).addEventListener('click', () => {
        volume = Math.max(0, volume + step)
        render()
        persist()
    })
}

restore()
