const input = document.querySelector('#q')
const echo = document.querySelector('#echo')
const spinner = document.querySelector('#searching')
const list = document.querySelector('#results')

// The three variables one option replaces, plus the one that is
// easiest to leave out: `token` is what stops a slow answer from
// landing on top of a faster one typed after it.
let rows = []
let timer = 0
let token = 0
let searching = false

function render() {
    echo.textContent = input.value
    spinner.hidden = !searching
    const items = []
    for (const row of rows) {
        const item = document.createElement('li')
        item.textContent = row.title
        items.push(item)
    }
    list.replaceChildren(...items)
}

async function run(q) {
    const mine = ++token
    // The held list keeps being served while this runs, which is
    // the whole reason the rows are not cleared here.
    searching = true
    render()
    const address = `/api/search?q=${encodeURIComponent(q)}`
    const response = await fetch(address)
    const landed = await response.json()
    if (mine !== token) return
    rows = landed
    searching = false
    render()
}

input.addEventListener('input', () => {
    // The echo follows the keystroke; only the LOAD is capped.
    render()
    clearTimeout(timer)
    timer = setTimeout(() => run(input.value), 200)
})

render()
