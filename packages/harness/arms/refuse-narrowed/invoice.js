const message = document.querySelector('#message')
const total = document.querySelector('#total')

const ON_ACCOUNT = [
    ['#i4310', '4310'],
    ['#i4311', '4311'],
    ['#i4312', '4312'],
]

let id = '4310'
let held = null
let failure = null

// THE MATCH, BY HAND. `name` is a string off the wire, so the branch
// and the field it reads are agreed by eye: `data.owner` under the
// wrong name is undefined at render rather than a compile error.
function messageFor(one) {
    if (one.name === 'NotYours') return `Owned by ${one.data.owner}.`
    if (one.name === 'Superseded') return `Replaced by #${one.data.replacedBy}.`
    return one.message
}

function render() {
    message.hidden = failure === null
    message.textContent = failure === null ? '' : messageFor(failure)
    total.textContent = failure === null ? (held?.total ?? '—') : '—'
    for (const [button, one] of ON_ACCOUNT) {
        document.querySelector(button).ariaSelected = String(one === id)
    }
}

function load() {
    held = null
    failure = null
    render()
    fetch(`/api/invoice?id=${id}`)
        .then((answer) => answer.json())
        .then((body) => {
            if (body.name === undefined) held = body
            else failure = body
            render()
        })
}

for (const [button, one] of ON_ACCOUNT) {
    document.querySelector(button).addEventListener('click', () => {
        id = one
        load()
    })
}

load()
