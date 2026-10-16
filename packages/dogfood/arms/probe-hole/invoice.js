const number = document.querySelector('#number')
const customer = document.querySelector('#customer')
const total = document.querySelector('#total')

// THE HOLES, WRITTEN BY HAND. Three of them here, and the count is
// the point: every place the value is read is a place that has to
// cope with not having it yet, so the branch is per SITE rather
// than per value.
fetch('/api/invoice?id=4021')
    .then((answer) => answer.json())
    .then((invoice) => {
        number.textContent = invoice.number
        customer.textContent = invoice.customer
        total.textContent = invoice.total
    })
