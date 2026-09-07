let query = 'a'
let current = null

const field = document.querySelector('#typed')
const results = document.querySelector('#results')

// THE ENTRY TABLE AND ITS KEY, WRITTEN BY HAND. The key is one
// string here and the general case is an args object, which is
// where a hand-written cache starts needing a canonical form.
// Without the table, a word searched twice is a second request
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
            render()
        })
    return entry
}

function render() {
    document.querySelector('#status').textContent = current.pending ? 'searching…' : ''
    results.replaceChildren(
        ...current.names.map((one) => {
            const item = document.createElement('li')
            item.textContent = one
            return item
        }),
    )
}

document.querySelector('#search').addEventListener('click', () => {
    query = field.value
    current = entryFor(query)
    render()
})

current = entryFor(query)
render()
