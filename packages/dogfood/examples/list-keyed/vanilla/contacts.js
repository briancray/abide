const list = document.querySelector('#rows')

let rows = [
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'grace', name: 'Grace Hopper' },
    { id: 'katherine', name: 'Katherine Johnson' },
]

// THE KEY-TO-NODE TABLE, WRITTEN BY HAND. Without it the cheap thing
// to write is `replaceChildren` over fresh rows, which is right on
// screen and wrong in the document: every node is a new one, so focus,
// selection and anything a row was in the middle of go with them.
const nodes = new Map()

function nodeFor(row) {
    let held = nodes.get(row.id)
    if (!held) {
        held = document.createElement('li')
        const key = document.createElement('span')
        key.textContent = row.id
        const name = document.createElement('strong')
        name.textContent = row.name
        held.append(key, name)
        nodes.set(row.id, held)
    }
    return held
}

function render() {
    // `append` on a node already in the list MOVES it rather than
    // copying it, which is what makes this a reorder.
    for (const row of rows) list.append(nodeFor(row))
}

document.querySelector('#swap').addEventListener('click', () => {
    const [first, second, ...rest] = rows
    rows = [second, first, ...rest]
    render()
})

document.querySelector('#reverse').addEventListener('click', () => {
    rows = [...rows].reverse()
    render()
})

render()
