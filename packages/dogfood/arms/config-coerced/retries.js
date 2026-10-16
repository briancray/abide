fetch('/api/retryPolicy')
    .then((answer) => answer.json())
    .then((policy) => {
        document.querySelector('#retries').textContent = policy.retries
        document.querySelector('#attempts').textContent = policy.retries + 1
    })
