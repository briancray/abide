const send = document.querySelector('#send')
const status = document.querySelector('#status')

// A FLAG FOR THE WAIT AND A BRANCH FOR THE REFUSAL, both set by the
// handler around the one request.
send.addEventListener('click', async () => {
    status.textContent = 'asking billing…'
    const response = await fetch('/api/sync?id=4310', { method: 'POST' })
    status.textContent = response.ok ? '' : await response.text()
})
