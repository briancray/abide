const email = document.querySelector('#email')
const seal = document.querySelector('#seal')

// THE PRINCIPAL, HELD BY HAND — and the half that is easy to forget is
// that it is TWO things: whether the seal was accepted, and what the app
// resolved from it. Kept as one variable they drift, and a page reads
// "signed in" beside a name belonging to whoever was here before.
let authenticated = false
let resolved = null

// AND THE READER LIST, which is what "everywhere" costs by hand: the
// header is not below the form, so the form has to be told about it.
const readers = new Set()

function wakeReaders() {
    for (const reader of readers) reader()
}

readers.add(() => {
    seal.textContent = authenticated ? 'Sign out' : 'Sign in'
})

readers.add(() => {
    document.querySelector('#state').textContent = authenticated ? 'yes' : 'no'
    document.querySelector('#who').textContent = resolved?.name ?? '—'
})

seal.addEventListener('click', () => {
    if (authenticated) {
        authenticated = false
        resolved = null
        wakeReaders()
        return
    }
    fetch('/api/signIn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.value }),
    }).then(async (answer) => {
        // The status, not a field: a refusal carries `name` and so does a
        // person, and the two collide the moment somebody is called Ada.
        if (!answer.ok) return
        const body = await answer.json()
        authenticated = body.authenticated
        resolved = body
        wakeReaders()
    })
})

wakeReaders()
