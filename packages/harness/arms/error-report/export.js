function loadCaptured() {
    return fetch('/api/capturedErrors')
        .then((answer) => answer.json())
        .then((captured) => {
            document.querySelector('#captured').textContent = captured[0] ?? '—'
        })
}

document.querySelector('#export').addEventListener('click', async () => {
    const answer = await fetch('/api/exportContacts', { method: 'POST' })
    if (!answer.ok)
        document.querySelector('#told').textContent =
            `${answer.status} ${answer.statusText}`
    await loadCaptured()
})

loadCaptured()
