const field = document.querySelector('#handle')
const heading = document.querySelector('#heading')

// THE LISTENER AND THE WRITE, BY HAND. Every place the value is
// shown needs one line here, and forgetting one is a heading that
// disagrees with the field it is named after.
field.addEventListener('input', () => {
    heading.textContent = `@${field.value}`
})
