const branch = document.querySelector('#branch')

const STATUSES = ['draft', 'sent', 'paid', 'overdue']

const LINES = {
    draft: 'Not sent yet.',
    paid: 'Settled — nothing to chase.',
    overdue: 'Chase this one.',
}

let status = 'draft'

// ONE BRANCH IN THE DOCUMENT, AND THE OTHER HALF OF THAT IS REMOVAL.
// Appending the new branch is the half anybody writes; clearing the one
// before it is the half that decides whether this is a switch or a
// growing list of every status the invoice has ever been.
function render() {
    branch.replaceChildren()
    const line = document.createElement('p')
    line.className = 'status'
    line.textContent = LINES[status] ?? 'Waiting on the customer.'
    branch.append(line)
    for (const one of STATUSES) {
        document.querySelector(`#${one}`).ariaSelected = String(one === status)
    }
}

for (const one of STATUSES) {
    document.querySelector(`#${one}`).addEventListener('click', () => {
        status = one
        render()
    })
}

render()
