document.querySelector('#sync').addEventListener('click', () => {
    fetch('/api/syncContact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '4021' }),
    })
        .then((answer) => answer.json())
        .then((synced) => {
            document.querySelector('#trace').textContent = synced.trace
            document.querySelector('#lines').textContent =
                synced.lines.join(' · ')
        })
})
