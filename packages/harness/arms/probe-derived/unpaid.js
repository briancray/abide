const out = document.querySelector('#unpaid')

// THE DERIVED VALUE'S OWN PENDING, WRITTEN BY HAND. The filter runs
// happily over nothing and returns an empty array, so the count is
// not what says whether it is ready — a second variable is, and it
// belongs to the SOURCE rather than to the value being shown.
let rows = null

function render() {
    if (rows === null) {
        out.textContent = 'counting…'
        return
    }
    out.textContent = String(rows.filter((row) => !row.paid).length)
}

fetch('/api/invoices')
    .then((answer) => answer.json())
    .then((loaded) => {
        rows = loaded
        render()
    })

render()
