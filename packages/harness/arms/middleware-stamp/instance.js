document.querySelector('#ask').addEventListener('click', () => {
    fetch('/api/ping').then((answer) => {
        document.querySelector('#served').textContent =
            answer.headers.get('x-served-by') ?? 'no header'
    })
})
