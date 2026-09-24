const draft = document.querySelector('#draft')

// FOUR CONVENTIONS, BY HAND, FOR ONE QUESTION. What you own is a
// variable and is never pending; what is derived is a call you have to
// remember to make; what is loaded is a promise beside a flag; what is
// pushed is a listener beside a list. Four spellings of "not here yet",
// and the one that goes wrong is whichever the next reader forgets.
let owned = ''
let loaded = null
let loading = true
let pushed = null

const readers = new Set()

function publish(note) {
    pushed = note
    for (const reader of readers) reader()
}

function derived() {
    return owned ? owned.split(' ').length : 0
}

function render() {
    document.querySelector('#owned').textContent = owned || '—'
    document.querySelector('#derived').textContent = String(derived())
    document.querySelector('#loaded').textContent = loading ? '…' : loaded.name
    document.querySelector('#pushed').textContent =
        pushed === null ? '…' : pushed.text
}

readers.add(render)

fetch('/api/getContact?id=1')
    .then((answer) => answer.json())
    .then((contact) => {
        loaded = contact
        loading = false
        render()
    })

draft.addEventListener('input', () => {
    owned = draft.value
    render()
})

document.querySelector('#add').addEventListener('click', () => {
    publish({ text: owned })
    owned = ''
    draft.value = ''
    render()
})

render()
