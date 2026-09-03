import { setCurrency } from './store.js'
import { money } from './money.js'

const rows = [
    { id: 'INV-0042', label: 'General ledger export', total: 1240 },
    { id: 'INV-0061', label: 'Ledger reconciliation', total: 880 },
    { id: 'INV-0088', label: 'Ledger import, Q3', total: 415 },
]

const list = document.querySelector('#rows')
const select = document.querySelector('#currency')

// The table has to know about the instances it made, because it is
// the only thing that can tear them down — so the path between the
// select and the values does have a parameter after all, and it is
// this array.
const live = []

for (const row of rows) {
    const item = document.createElement('li')
    const { element, stop } = money(row.total)
    item.append(`${row.label} — `, element)
    list.append(item)
    live.push(stop)
}

select.addEventListener('change', () => setCurrency(select.value))
addEventListener('pagehide', () => {
    for (const stop of live) stop()
})
