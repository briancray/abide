const field = document.querySelector('#email')
const message = document.querySelector('#message')
const stored = document.querySelector('#stored')

// THE SHAPE, SPELLED A SECOND TIME. The type says `string` and this
// says what kind of string, so the two can disagree and only one of
// them is what the record is actually checked against.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

let held = 'ada@example.com'
let issues = null

function write(typed) {
    if (!EMAIL.test(typed)) {
        issues = ['That is not an email address.']
        return
    }
    issues = null
    held = typed
}

function render() {
    message.hidden = issues === null
    message.textContent = issues === null ? '' : issues[0]
    stored.textContent = held
}

field.addEventListener('input', () => {
    write(field.value)
    render()
})

render()
