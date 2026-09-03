const table = document.getElementById('orders')
const count = document.getElementById('count')
const loading = document.getElementById('loading')

// The index the page holds, and the row elements it has already
// painted — two maps, because the DOM has no way back from an id.
const byId = new Map()
const rowFor = new Map()

function cells(order) {
    return [
        `#${order.id}`,
        order.customer,
        order.status,
        `$${order.total.toFixed(2)}`,
    ]
}

function paint(order) {
    let row = rowFor.get(order.id)
    if (!row) {
        row = document.createElement('tr')
        for (let at = 0; at < 4; at += 1) row.appendChild(document.createElement('td'))
        rowFor.set(order.id, row)
        insert(row, order.id)
    }
    const text = cells(order)
    // Compare before writing: a frame usually moves one cell, and a
    // blind write of all four is three layout invalidations for free.
    for (let at = 0; at < 4; at += 1) {
        if (row.children[at].textContent !== text[at]) {
            row.children[at].textContent = text[at]
        }
    }
}

// Keep the table sorted by id without re-appending every row.
function insert(row, id) {
    for (const existing of table.rows) {
        const at = Number(existing.cells[0]?.textContent?.slice(1))
        if (at > id) return table.insertBefore(row, existing)
    }
    table.appendChild(row)
}

function remove(id) {
    rowFor.get(id)?.remove()
    rowFor.delete(id)
    byId.delete(id)
}

function apply({ id, order }) {
    if (order === null) return remove(id)
    byId.set(id, order)
    paint(order)
}

const response = await fetch('/api/orders')
for (const order of await response.json()) {
    byId.set(order.id, order)
    paint(order)
}
loading.remove()
count.textContent = String(byId.size)

const feed = new EventSource('/api/orders/changes')
feed.addEventListener('message', (event) => {
    apply(JSON.parse(event.data))
    count.textContent = String(byId.size)
})
feed.addEventListener('error', () => {
    // A dropped feed has no cursor to resume from, so the whole list
    // is refetched and every row repainted.
    feed.close()
    location.reload()
})
