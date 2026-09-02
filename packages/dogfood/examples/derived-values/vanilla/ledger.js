const state = { rows: [], showPaid: false }

const box = document.querySelector('#show-paid')
const list = document.querySelector('#rows')
const summary = document.querySelector('#summary')
const spinner = document.querySelector('#counting')

// Both derivations, and the list of what should re-run them, which
// is the part that goes stale.
function visible() {
    return state.showPaid ? state.rows : state.rows.filter((row) => !row.paid)
}

function total() {
    return visible().reduce((sum, row) => sum + row.total, 0)
}

function render() {
    const rows = visible()
    list.replaceChildren(
        ...rows.map((row) => {
            const item = document.createElement('li')
            item.textContent = `${row.ref} — ${row.total}`
            return item
        }),
    )
    summary.textContent = `${total()} due across ${rows.length} invoices`
}

box.addEventListener('change', () => {
    state.showPaid = box.checked
    render()
})

async function load(year) {
    spinner.hidden = false
    const response = await fetch(`/api/invoices?year=${year}`)
    state.rows = await response.json()
    spinner.hidden = true
    render()
}

render()
load(2026)
