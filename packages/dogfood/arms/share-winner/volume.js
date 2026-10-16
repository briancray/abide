const shared = new Map()

// GET-OR-CREATE, WRITTEN BY HAND. The second caller's box is
// dropped on the floor, and nothing about that is visible from
// the call — which is the whole hazard the card is about.
function share(key, build) {
    let held = shared.get(key)
    if (!held) {
        held = { value: build(), readers: new Set() }
        shared.set(key, held)
    }
    return held
}

const volume = share('volume', () => ({ level: 4 }))

// Built out here and handed in. `share` already had one, so this
// box is the loser and the name goes on pointing at it.
const built = { level: 4 }
const second = share('volume', () => built)

function render() {
    document.querySelector('#volume').textContent = String(volume.value.level)
    document.querySelector('#shared').textContent = String(second.value.level)
    document.querySelector('#built').textContent = String(built.level)
}

for (const [id, step] of [
    ['#up', 1],
    ['#down', -1],
]) {
    document.querySelector(id).addEventListener('click', () => {
        volume.value.level = Math.max(0, volume.value.level + step)
        render()
    })
}

render()
