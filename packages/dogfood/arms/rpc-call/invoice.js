// THE CLIENT HALF, WRITTEN BY HAND. The address, the method and
// the argument encoding are all repeated here, and none of them is
// checked against the handler — a renamed field or a moved route
// is a runtime 404 rather than a compile error.
function getInvoice({ id }) {
    return fetch(`/api/invoices/get?id=${encodeURIComponent(id)}`).then(
        (answer) => answer.json(),
    )
}

getInvoice({ id: '4021' }).then((invoice) => {
    document.querySelector('#number').textContent = invoice.number
    document.querySelector('#due').textContent = invoice.dueOn
    document.querySelector('#total').textContent = invoice.total
})
