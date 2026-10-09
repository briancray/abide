document.querySelector('#fetch').addEventListener('click', () => {
    fetch('/api/pool').then((answer) => {
        document.querySelector('#status').textContent = String(answer.status)
        document.querySelector('#traced').textContent =
            answer.headers.get('traceresponse') ?? 'none'
    })
})
