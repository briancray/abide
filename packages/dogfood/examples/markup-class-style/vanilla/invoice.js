const badge = document.querySelector('#badge')

let daysLate = 0

// ONE CLASS AND ONE PROPERTY, REACHED THROUGH THE TWO APIS THAT DO NOT
// TOUCH THE REST. `classList.toggle` leaves every other class alone and
// `style.opacity` leaves every other property alone — which is the part
// a `class=` or a `style=` built as a string gives up.
function render() {
    badge.classList.toggle('overdue', daysLate > 0)
    badge.style.opacity = String(daysLate > 0 ? 1 : 0.45)
    badge.textContent = daysLate > 0 ? `${daysLate} days late` : 'on time'
}

document.querySelector('#later').addEventListener('click', () => {
    daysLate += 3
    render()
})

document.querySelector('#earlier').addEventListener('click', () => {
    daysLate = Math.max(0, daysLate - 3)
    render()
})

render()
