// ONE STORE PER KEY, DERIVED FROM THE KEY. Closing over one
// address instead gives every entry the same store and they
// clobber each other silently — both profiles read back whichever
// was written last, and nothing about that looks wrong.
function storeFor(profile) {
    const at = `settings:${profile}`
    return {
        get: () => fetch(`/api/store?at=${at}`).then((answer) => answer.json()),
    }
}

function show(profile, id) {
    storeFor(profile)
        .get()
        .then((stored) => {
            document.querySelector(id).textContent = stored.theme
        })
}

show('ada', '#ada')
show('grace', '#grace')
