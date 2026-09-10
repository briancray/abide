const status = document.querySelector('#status')
const payments = document.querySelector('#payments')

// THE IN-FLIGHT TABLE, WRITTEN BY HAND. One entry here because
// there is one invoice; a page with a list of them keeps a table
// keyed by the arguments, and the write that skips it is a second
// payment on the record before anything on screen looks wrong.
let flight = null

function pay() {
    if (flight) return
    status.textContent = 'paying…'
    flight = fetch('/api/payInvoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '4310' }),
    })
        .then((answer) => answer.json())
        .then((paid) => {
            payments.textContent = paid.payments
            status.textContent = ''
            flight = null
        })
}

document.querySelector('#pay').addEventListener('click', pay)
