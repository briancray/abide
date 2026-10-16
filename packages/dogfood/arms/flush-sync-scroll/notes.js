const list = document.querySelector('#notes')
const count = document.querySelector('#count')
const measured = document.querySelector('#measured')

// NOTHING TO FLUSH: the render is called by hand and writes the DOM
// before it returns, so the measurement after it is already right.
// What the arm pays instead is the render call at every write.
const notes = ['Called about the renewal', 'Sent the new quote']

function render() {
    for (let index = list.children.length; index < notes.length; index += 1) {
        const row = document.createElement('li')
        row.textContent = notes[index]
        list.append(row)
    }
    count.textContent = String(notes.length)
}

document.querySelector('#add').addEventListener('click', () => {
    notes.push(`Follow-up ${notes.length - 1}`)
    render()
    list.scrollTop = list.scrollHeight
    measured.textContent = String(list.children.length)
})

render()
