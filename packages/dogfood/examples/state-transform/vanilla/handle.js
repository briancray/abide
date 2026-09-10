const field = document.querySelector('#handle')
const stored = document.querySelector('#stored')

// THE NORMALISATION, BY HAND, AT EVERY WRITE SITE. Here there is
// one; a second place that writes the handle needs the same call,
// and the one that forgets it is what puts a capital in the
// column.
function normalise(typed) {
    return typed.trim().toLowerCase().replaceAll(' ', '_')
}

field.addEventListener('input', () => {
    const value = normalise(field.value)
    field.value = value
    stored.textContent = `@${value || '—'}`
})
