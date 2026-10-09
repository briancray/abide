const preview = document.querySelector('#preview')
const tabs = document.querySelectorAll('.tabs button')

function show(id) {
    preview.src = `/api/previewInvoice?id=${encodeURIComponent(id)}`
    for (const tab of tabs)
        tab.setAttribute('aria-selected', String(tab.id === `inv-${id}`))
}

for (const tab of tabs) tab.onclick = () => show(tab.id.slice('inv-'.length))
show('4021')
