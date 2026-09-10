const field = document.querySelector('#notes')
const saved = document.querySelector('#saved')

// THE PREVIOUS RUN'S TIMER, HELD BY HAND. It is one variable and
// one `clearTimeout`, and the cost is that it is a variable that
// must not be forgotten: drop it and every keystroke leaves a
// timer running, all of them firing, and the page still looks
// right because the last one to land holds the newest draft.
let timer = null

field.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer)
    const draft = field.value
    timer = setTimeout(() => {
        saved.textContent = draft
        timer = null
    }, 600)
})
