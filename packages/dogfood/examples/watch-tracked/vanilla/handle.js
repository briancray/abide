const field = document.querySelector('#handle')
const tab = document.querySelector('#tab')

let handle = 'ada'

// THE EFFECT, AND EVERY PLACE THAT HAS TO REMEMBER TO RUN IT. It
// hangs off the value in principle and off each WRITER in fact, so
// a third thing that moves the handle keeps the title only if
// whoever adds it also calls this.
function retitle() {
    document.title = `@${handle} \u2014 Contacts`
    tab.textContent = document.title
}

field.addEventListener('input', () => {
    handle = field.value
    retitle()
})

document.querySelector('#reset').addEventListener('click', () => {
    handle = 'ada'
    field.value = handle
    retitle()
})

retitle()
