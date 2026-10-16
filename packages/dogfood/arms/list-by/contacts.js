const table = document.querySelector('#rows')
const queue = document.querySelector('#queue')

let contacts = [
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'grace', name: 'Grace Hopper' },
    { id: 'katherine', name: 'Katherine Johnson' },
]

// A KEY-TO-NODE TABLE PER LIST, each keyed by hand on the same
// `contact.id`. A third list over these contacts is a third table.
const tableNodes = new Map()
const queueNodes = new Map()

function tableNodeFor(contact) {
    let held = tableNodes.get(contact.id)
    if (!held) {
        held = document.createElement('li')
        const key = document.createElement('span')
        key.textContent = contact.id
        const name = document.createElement('strong')
        name.textContent = contact.name
        held.append(key, name)
        tableNodes.set(contact.id, held)
    }
    return held
}

function queueNodeFor(contact) {
    let held = queueNodes.get(contact.id)
    if (!held) {
        held = document.createElement('li')
        held.textContent = contact.name
        queueNodes.set(contact.id, held)
    }
    return held
}

function render() {
    // `append` on a node already in the list MOVES it rather than
    // copying it, which is what makes this a reorder.
    for (const contact of contacts) {
        table.append(tableNodeFor(contact))
        queue.append(queueNodeFor(contact))
    }
}

document.querySelector('#swap').addEventListener('click', () => {
    const [first, second, ...rest] = contacts
    contacts = [second, first, ...rest]
    render()
})

render()
