const notes = document.querySelector('#notes')
const owner = document.querySelector('#owner')
const audited = document.querySelector('#audited')

// THE NARROWING, WRITTEN BY HAND, and by hand it is not a list of
// sources — it is the ABSENCE of a listener. The effect reads both
// values and is wired to one of them, so what wakes it is a fact
// about which lines were written rather than something stated.
function audit() {
    audited.textContent = `${owner.value} — ${notes.value.length} characters of notes`
}

owner.addEventListener('change', audit)

audit()
