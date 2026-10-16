function signInAs(id) {
    fetch('/api/signInAs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
    })
        .then((answer) => answer.json())
        .then((user) => {
            document.querySelector('#sealed').textContent = user.id
            document.querySelector('#name').textContent = user.name
            document.querySelector('#role').textContent = user.role
        })
}

document.querySelector('#ada').addEventListener('click', () => signInAs('ada'))
document
    .querySelector('#grace')
    .addEventListener('click', () => signInAs('grace'))
