// THE SCOPE, WRITTEN BY HAND. A registry keyed by name alone is
// process-wide, so the two shelves would land on one value and
// neither could see the collision. Keeping them apart means
// carrying the subtree into the key at every call — and handing
// that subtree down to everything rendered below, which is the
// half that has to be threaded through props the page did not want.
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

function queueControl(scope, label) {
    const held = share(scope, 'queued', () => 'nothing')
    const out = document.querySelector(`#${scope}-below`)
    held.readers.add((value) => {
        out.textContent = value
    })
    document.querySelector(`#queue-${scope}`).addEventListener('click', () => {
        held.value = `${label} pick`
        for (const reader of held.readers) reader(held.value)
    })
}

function shelf(scope, label) {
    const held = share(scope, 'queued', () => 'nothing')
    const out = document.querySelector(`#${scope}`)
    held.readers.add((value) => {
        out.textContent = value
    })
    queueControl(scope, label)
}

shelf('jazz', 'jazz')
shelf('ambient', 'ambient')
