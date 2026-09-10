const tierOut = document.querySelector('#tier')
const regionsOut = document.querySelector('#regions')

// MEMBERSHIP, WRITTEN OUT. A radio is one value out of a set and a
// checkbox set is an array, and neither is what a DOM property
// hands you — so each group needs its own reader, and the checkbox
// one has to add and remove rather than assign.
const form = { tier: 'gold', regions: ['north'] }

function render() {
    tierOut.textContent = form.tier
    regionsOut.textContent = form.regions.join(', ')
}

for (const id of ['#silver', '#gold']) {
    document.querySelector(id).addEventListener('change', (event) => {
        if (event.target.checked) form.tier = event.target.value
        render()
    })
}

for (const id of ['#north', '#south']) {
    document.querySelector(id).addEventListener('change', (event) => {
        const value = event.target.value
        const at = form.regions.indexOf(value)
        if (event.target.checked && at === -1) form.regions.push(value)
        if (!event.target.checked && at !== -1) form.regions.splice(at, 1)
        render()
    })
}

render()
