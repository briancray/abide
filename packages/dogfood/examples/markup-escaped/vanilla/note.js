const field = document.querySelector('#note')
const text = document.querySelector('#text')
const markup = document.querySelector('#markup')

// TWO PROPERTIES, AND THE CONVENIENT ONE IS THE UNSAFE ONE. Nothing
// about `innerHTML` says it is the exception, so a site that meant
// `textContent` and reached for the other reads the same on the page
// it renders correctly.
function render() {
    text.textContent = field.value
    markup.innerHTML = field.value
}

field.addEventListener('input', render)

render()
