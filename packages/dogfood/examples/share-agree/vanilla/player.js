const LIBRARY = ['Kind of Blue', 'A Love Supreme', 'Blue Train']

// THE REGISTRY AND ITS SCOPE, WRITTEN BY HAND: one value per key
// per subtree, built where the page asked for it, plus the readers
// to wake when it moves. The scope is what stops two unrelated
// parts of an app colliding on a short word, and carrying it to
// every call is the cost of having it.
const shared = new Map()

function share(scope, key, build) {
    const at = `${scope} ${key}`
    let held = shared.get(at)
    if (!held) {
        held = { value: build(), readers: new Set() }
        shared.set(at, held)
    }
    return held
}

// The page holds it, so both readers resolve to the page's scope.
const PAGE = 'library'
share(PAGE, 'nowPlaying', () => 'nothing')

function write(value) {
    const held = share(PAGE, 'nowPlaying', () => 'nothing')
    held.value = value
    for (const reader of held.readers) reader(value)
}

function read(reader) {
    const held = share(PAGE, 'nowPlaying', () => 'nothing')
    held.readers.add(reader)
    reader(held.value)
}

const label = document.querySelector('#playing')

read((value) => {
    label.textContent = value
})

LIBRARY.forEach((title, index) => {
    document.querySelector(`#t${index}`).addEventListener('click', () => {
        write(title)
    })
})
