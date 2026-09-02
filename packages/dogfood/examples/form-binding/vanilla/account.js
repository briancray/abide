const input = document.querySelector('#name')
const out = document.querySelector('#greeting')

function render() {
    out.textContent = `Hello ${input.value}`
}

input.addEventListener('input', render)
render()
