// THE REFERENCE, FETCHED BY A NAME THAT LIVES IN TWO FILES. The markup
// says `id="note"` and this says `#note`, and nothing checks that they
// still agree — a rename in one of them is a null at the first press.
const field = document.querySelector('#note')
const shown = document.querySelector('#state')

function render(focused) {
    shown.textContent = focused ? 'focused' : 'idle'
}

field.addEventListener('focus', () => render(true))
field.addEventListener('blur', () => render(false))

document.querySelector('#new').addEventListener('click', () => {
    field.value = ''
    field.focus()
})
