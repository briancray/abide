const field = document.querySelector('#city')
const heading = document.querySelector('#heading')

let contact = {
    name: 'Ada Lovelace',
    address: { city: 'London', country: 'UK' },
}

// THE IDENTITY CHECK A DERIVED VALUE NEEDS, and the copy below is what
// keeps it honest. Writing `contact.address.city` in place leaves the
// object the object it was, so this check reads no change and the line
// keeps the city it had.
let last = null
let shown = ''

function lineFor() {
    if (contact !== last) {
        last = contact
        shown = `${contact.name} — ${contact.address.city}`
    }
    return shown
}

// THE COPY, ONE LEVEL PER SEGMENT OF THE PATH. Two here; a field three
// deep is three, and the level that gets missed is the one nothing
// downstream re-reads.
function setCity(city) {
    contact = { ...contact, address: { ...contact.address, city } }
}

function render() {
    heading.textContent = lineFor()
}

field.addEventListener('input', () => {
    setCity(field.value)
    render()
})

render()
