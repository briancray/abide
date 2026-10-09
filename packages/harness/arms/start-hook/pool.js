fetch('/api/pool')
    .then((answer) => answer.json())
    .then((pool) => {
        document.querySelector('#connected').textContent = pool.connectedAt
        document.querySelector('#up').textContent = pool.upAt
    })
