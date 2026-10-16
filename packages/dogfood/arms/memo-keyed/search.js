const field = document.querySelector('#query')
const results = document.querySelector('#results')
const status = document.querySelector('#status')

let current = null

// THE ENTRY TABLE AND ITS KEY, WRITTEN BY HAND. The key is one
// string here and the general case is an args object, which is
// where a hand-written cache starts needing a canonical form.
// Without the table, a prefix typed twice is a second request
// and a second spinner.
const entries = new Map()

function entryFor(word) {
    const held = entries.get(word)
    if (held) return held
    const entry = { names: [], pending: true }
    entries.set(word, entry)
    fetch(`/api/search?query=${word}`)
        .then((response) => response.json())
        .then((names) => {
            entry.names = names
            entry.pending = false
            // The entry IS the token: an answer for a word since typed
            // past lands in its own entry and paints nothing.
            if (entry === current) render()
        })
    return entry
}

function render() {
    status.textContent = current.pending ? 'searching…' : ''
    results.replaceChildren(
        ...current.names.map((one) => {
            const item = document.createElement('li')
            item.textContent = one
            return item
        }),
    )
}

field.addEventListener('input', () => {
    current = entryFor(field.value)
    render()
})

current = entryFor(field.value)
render()
