fetch('/health')
    .then((answer) => answer.json())
    .then((account) => {
        document.querySelector('#version').textContent = account.version
        document.querySelector('#started').textContent = account.startedAt
        document.querySelector('#database').textContent = account.database
    })
