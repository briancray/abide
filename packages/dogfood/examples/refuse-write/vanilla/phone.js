const draft = document.querySelector('#draft')
const message = document.querySelector('#message')
const stored = document.querySelector('#stored')

let phone = ''
let failure = null

// THE GUARD AT THE WRITE SITE, and the two things it has to do
// besides refusing: leave the last good value standing, and clear
// the standing failure on the write that succeeds.
function save(typed) {
    const digits = typed.replaceAll(/\D/g, '')
    if (digits.length !== 10) {
        failure = { name: 'NotAPhone', data: { typed } }
        return
    }
    failure = null
    phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function render() {
    message.hidden = failure === null
    message.textContent =
        failure === null ? '' : `“${failure.data.typed}” is not ten digits.`
    stored.textContent = phone
}

document.querySelector('#save').addEventListener('click', () => {
    save(draft.value)
    render()
})

save(draft.value)
render()
